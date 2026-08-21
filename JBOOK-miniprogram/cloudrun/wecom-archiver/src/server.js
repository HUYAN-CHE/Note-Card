// 企微会话存档拉取服务（云托管容器常驻）
// 每 2 分钟一轮：sdk_cli getchat 拉加密消息 → Node 侧 RSA 私钥解 encrypt_random_key
//   → sdk_cli decrypt 解出明文 → 过滤（仅外部联系人单聊文本）→ 调云函数 wecomIngest
// 游标 seq 持久化在云数据库 wecomArchiveState 集合（单行 _id='main'）
// 环境变量（云托管控制台配置）：
//   WECOM_CORPID        企业 ID
//   WECOM_SECRET        会话内容存档 Secret
//   WECOM_PRIVATE_KEY   RSA 私钥 PEM（与后台配置的公钥配对， PKCS8/PKCS1 均可）
//   INGEST_SYSTEM_KEY   wecomIngest 系统通道凭证（与云函数环境变量一致）
// HTTP 端点：GET / 健康检查；GET /pull 手动触发一轮（联调用）
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const cloudbase = require('@cloudbase/node-sdk');

const SDK_CLI = process.env.SDK_CLI || '/app/bin/sdk_cli';
const POLL_INTERVAL_MS = 2 * 60 * 1000;
const PULL_LIMIT = 500; // 单轮上限 500 条（官方单次上限 1000，留余量）

// 进程防崩：常驻服务的任何未捕获异常只记日志不退场（崩了探针失败会被云托管判部署失败）
process.on('unhandledRejection', (e) => console.error(new Date().toISOString(), '[unhandledRejection]', (e && e.message) || e));
process.on('uncaughtException', (e) => console.error(new Date().toISOString(), '[uncaughtException]', (e && e.message) || e));

// 环境 ID：云托管注入变量名不确定，三级兜底（最后一个就是本项目环境 cloud1）
const ENV_ID = process.env.CBR_ENV_ID || process.env.ENV_ID || 'cloud1-d3gsqteqm9c3866ac';
const app = cloudbase.init({ env: ENV_ID });
const db = app.database();
const STATE_COL = 'wecomArchiveState';
const STATE_ID = 'main';

const PRIVATE_KEY = (process.env.WECOM_PRIVATE_KEY || '').replace(/\\n/g, '\n');

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

// 读游标：无记录返回 0（首次从头拉，官方允许任意 seq 重入）
async function loadSeq() {
  try {
    const res = await db.collection(STATE_COL).doc(STATE_ID).get();
    return (res.data && res.data[0] && res.data[0].seq) || 0;
  } catch (e) {
    return 0; // 文档不存在等场景视为首轮
  }
}

async function saveSeq(seq) {
  const data = { seq, updatedAt: Date.now() };
  try {
    await db.collection(STATE_COL).doc(STATE_ID).update({ data });
  } catch (e) {
    // 文档不存在则新建（_id 显式指定）
    await db.collection(STATE_COL).add({ data: { _id: STATE_ID, ...data } });
  }
}

// RSA 解密 encrypt_random_key：企微用后台配置的公钥 RSA/PKCS1 加密，用配对私钥解
function decryptRandomKey(encryptRandomKeyB64) {
  const encrypted = Buffer.from(encryptRandomKeyB64, 'base64');
  return crypto.privateDecrypt(
    { key: PRIVATE_KEY, padding: crypto.constants.RSA_PKCS1_PADDING },
    encrypted
  ).toString('utf8');
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

// 调云函数 wecomIngest（云托管内免鉴权调同环境云函数）
async function ingest(item) {
  const res = await app.callFunction({
    name: 'wecomIngest',
    data: {
      action: 'ingest',
      externalUserid: item.externalUserid,
      msgType: 'text',
      content: item.content,
      msgId: item.msgId || '',
      msgTime: item.msgTime || 0,
      // 与 wecomIngest 云函数的默认凭证一致（环境变量优先），不配也能对上
      systemKey: process.env.INGEST_SYSTEM_KEY || 'jishika-ingest-2026'
    }
  });
  return res.result;
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
    if (!chatdata.length) return; // 无新消息
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
        const r = await ingest(m);
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
  // INGEST_SYSTEM_KEY 有默认值兜底（见 ingest()），不在必需列表
  const missing = ['WECOM_CORPID', 'WECOM_SECRET', 'WECOM_PRIVATE_KEY'].filter((k) => !process.env[k]);
  if (missing.length) log('[env] 缺少环境变量:', missing.join(','));
  return missing.length === 0;
}

const server = http.createServer(async (req, res) => {
  // Spike 自检：容器内跑 sdk_cli selfcheck，验证 C SDK 可加载（不需要任何凭证）
  if (req.url === '/selfcheck') {
    try {
      const out = await runSdkCli(['selfcheck']);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, output: out }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
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
