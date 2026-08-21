// 企微会话存档拉取服务（云托管容器常驻）
// 每 2 分钟一轮：sdk_cli getchat 拉加密消息 → Node 侧 RSA 私钥解 encrypt_random_key
//   → sdk_cli decrypt 解出明文 → 过滤（仅外部联系人单聊文本）→ HTTPS POST 调 wecomIngest 云函数
// 云函数通道：HTTP 触发器（容器模式不注入 SDK 密钥，@cloudbase/node-sdk 不可用，改走 HTTPS + systemKey）
// 游标 seq：由 wecomIngest 的 getSeq/saveSeq 读写云数据库（wecomArchiveState 集合）
// 环境变量（云托管控制台配置）：
//   WECOM_CORPID        企业 ID
//   WECOM_SECRET        会话内容存档 Secret
//   WECOM_PRIVATE_KEY   RSA 私钥 PEM（单行 \n 转义，代码内还原）
//   INGEST_URL          wecomIngest 的 HTTP 触发器地址（控制台「HTTP 网关」配置后获得）
//   INGEST_SYSTEM_KEY   可选，默认与云函数内一致
// HTTP 端点：GET / 健康检查；GET /pull 手动触发一轮（联调用）；GET /envs 列环境变量键名（调试）
const http = require('http');
const https = require('https');
const fs = require('fs');
const { execFile, spawnSync } = require('child_process');

const SDK_CLI = process.env.SDK_CLI || '/app/bin/sdk_cli';
const POLL_INTERVAL_MS = 2 * 60 * 1000;
const PULL_LIMIT = 500; // 单轮上限 500 条（官方单次上限 1000，留余量）

const PRIVATE_KEY = (process.env.WECOM_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const INGEST_KEY = process.env.INGEST_SYSTEM_KEY || 'jishika-ingest-2026';
// 私钥落盘供 openssl CLI 使用（Node 20 已禁用 crypto 的 RSA_PKCS1 私钥解密，CVE-2023-46809）
const PRIVATE_KEY_FILE = '/tmp/wecom_msg_archive_key.pem';
if (PRIVATE_KEY) {
  try {
    fs.writeFileSync(PRIVATE_KEY_FILE, PRIVATE_KEY, { mode: 0o600 });
  } catch (e) {
    console.error(new Date().toISOString(), '[boot] 私钥写入失败', e.message);
  }
}

// 进程防崩：常驻服务的任何未捕获异常只记日志不退场（崩了探针失败会被云托管判部署失败）
process.on('unhandledRejection', (e) => console.error(new Date().toISOString(), '[unhandledRejection]', (e && e.message) || e));
process.on('uncaughtException', (e) => console.error(new Date().toISOString(), '[uncaughtException]', (e && e.message) || e));

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// 调 sdk_cli 子进程，stdout 收 JSON 文本；失败 reject 带 stderr
function runSdkCli(args) {
  return new Promise((resolve, reject) => {
    execFile(SDK_CLI, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`sdk_cli ${args[0]} fail: ${stderr || err.message}`));
      resolve(stdout.trim());
    });
  });
}

// HTTPS POST 调 wecomIngest（HTTP 触发器），body 为 JSON；返回解析后的 result
function callIngest(payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(process.env.INGEST_URL || '');
    const body = JSON.stringify({ ...payload, systemKey: INGEST_KEY });
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`ingest 响应非 JSON: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('ingest 调用超时')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function loadSeq() {
  const r = await callIngest({ action: 'getSeq' });
  return (r && r.data && r.data.seq) || 0;
}

async function saveSeq(seq) {
  await callIngest({ action: 'saveSeq', seq });
}

// RSA 解密 encrypt_random_key：企微用后台配置的公钥 RSA/PKCS1 加密，用配对私钥解
// Node 20 的 crypto 已禁用 PKCS1 私钥解密，改用 openssl CLI（spawnSync 同步执行，单条毫秒级）
function decryptRandomKey(encryptRandomKeyB64) {
  const encrypted = Buffer.from(encryptRandomKeyB64, 'base64');
  const r = spawnSync('openssl', ['pkeyutl', '-decrypt', '-inkey', PRIVATE_KEY_FILE, '-pkeyopt', 'rsa_padding_mode:pkcs1'], {
    input: encrypted,
    maxBuffer: 1024 * 1024
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error('openssl decrypt fail: ' + (r.stderr || '').toString().slice(0, 200));
  return r.stdout.toString('utf8');
}

// 单条明文消息路由：仅处理外部联系人（wm/wo 开头）发来的单聊文本
// 群消息(roomid 非空)、助手自己发的、其它类型（语音/图片/聊天记录）首期不处理
function pickMessage(msg) {
  if (!msg || msg.action !== 'send') return null;
  if (msg.roomid) return null;
  if (!/^w[mo]/.test(msg.from || '')) return null;
  if (msg.msgtype !== 'text') return null;
  const content = msg.text && msg.text.content;
  if (!content || !content.trim()) return null;
  return { externalUserid: msg.from, content: content.trim(), msgId: msg.msgid, msgTime: msg.msgtime };
}

let pulling = false;

async function pullOnce() {
  if (pulling) return log('[pull] 上一轮未结束，跳过');
  pulling = true;
  try {
    const seq = await loadSeq();
    const raw = await runSdkCli(['getchat', process.env.WECOM_CORPID || '', process.env.WECOM_SECRET || '', String(seq), String(PULL_LIMIT)]);
    const payload = JSON.parse(raw);
    if (payload.errcode !== 0) {
      log('[pull] GetChatData errcode', payload.errcode, payload.errmsg);
      return;
    }
    const chatdata = payload.chatdata || [];
    if (!chatdata.length) return log('[pull] 无新消息');
    log(`[pull] 拉到 ${chatdata.length} 条，seq ${seq} → ${chatdata[chatdata.length - 1].seq}`);

    let maxSeq = seq;
    // 先解密收集本轮全部有效消息（单条失败不阻塞整轮）
    const pickedList = [];
    for (const item of chatdata) {
      if (item.seq > maxSeq) maxSeq = item.seq;
      try {
        const encryptKey = decryptRandomKey(item.encrypt_random_key);
        const plainRaw = await runSdkCli(['decrypt', encryptKey, item.encrypt_chat_msg]);
        const msg = JSON.parse(plainRaw);
        const picked = pickMessage(msg);
        if (picked) pickedList.push(picked);
      } catch (e) {
        // 单条失败（含私钥版本不对 10007 等）不阻塞整轮，打日志继续
        console.error(new Date().toISOString(), '[msg] 处理失败 seq=' + item.seq, e.message);
      }
    }

    // 窗口期合并：同一发送者相邻 <60 秒的连续消息拼成一条，一次 AI 整理成一张卡
    //（"周五前给回复"这类补充信息与上文不割裂；超过阈值各自成卡）
    pickedList.sort((a, b) => a.msgTime - b.msgTime);
    const merged = [];
    for (const m of pickedList) {
      const last = merged[merged.length - 1];
      if (last && last.externalUserid === m.externalUserid && m.msgTime - last.msgTime < 60000) {
        last.content += '\n' + m.content;
        last.msgTime = m.msgTime;
      } else {
        merged.push({ ...m });
      }
    }

    for (const m of merged) {
      try {
        const r = await callIngest({
          action: 'ingest',
          externalUserid: m.externalUserid,
          msgType: 'text',
          content: m.content,
          msgId: m.msgId || '',
          msgTime: m.msgTime || 0
        });
        log('[ingest]', m.externalUserid, JSON.stringify(r));
      } catch (e) {
        console.error(new Date().toISOString(), '[ingest] 调用失败', m.externalUserid, e.message);
      }
    }
    await saveSeq(maxSeq);
  } catch (e) {
    console.error(new Date().toISOString(), '[pull] 失败', e.message);
  } finally {
    pulling = false;
  }
}

function checkEnv() {
  const missing = ['WECOM_CORPID', 'WECOM_SECRET', 'WECOM_PRIVATE_KEY', 'INGEST_URL'].filter((k) => !process.env[k]);
  if (missing.length) log('[env] 缺少环境变量:', missing.join(','));
  return missing.length === 0;
}

const server = http.createServer(async (req, res) => {
  // 调试：列出容器内环境变量键名（只列键名不列值）
  if (req.url === '/envs') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: Object.keys(process.env).sort() }));
    return;
  }
  if (req.url === '/pull') {
    pullOnce(); // 异步触发，不阻塞响应
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pulling: true }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, service: 'wecom-archiver', time: Date.now() }));
});

const PORT = process.env.PORT || 80;
server.listen(PORT, () => {
  log(`[boot] wecom-archiver listening on ${PORT}`);
  if (!checkEnv()) return; // 环境变量不齐：只提供 HTTP，不启动拉取
  pullOnce(); // 启动即拉一轮
  setInterval(pullOnce, POLL_INTERVAL_MS);
});
