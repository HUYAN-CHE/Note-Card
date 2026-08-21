// 企微私聊消息入卡：会话存档容器拉到消息后调用（首期仅文本）
//   ingest  { externalUserid, msgType, content, msgId?, msgTime?, systemKey? }
// 流程：按 externalUserid 找绑定用户 → 未绑定且内容是 8 位会员码则互调 membership.bindByCode 完成绑定；
//   未绑定非会员码 / 会员已过期 → 存 wecomPending 待认领区（不丢不串）；
//   会员 active → 互调 parseContext AI 整理 → 写 cards（draft + source:'wecom'）→ messages 通知「已记成卡片」
// 鉴权（两类调用方）：
//   1. 存档容器：无用户上下文，凭 systemKey（环境变量 INGEST_SYSTEM_KEY 优先）
//   2. 管理页模拟测试：带 openid，须为 admins 集合中的管理员
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const USERS = 'users';
const CARDS = 'cards';
const MESSAGES = 'messages';
const PENDING = 'wecomPending';

// 与 membership 的 PAY_SYSTEM_KEY 同模式：凭证只在云函数/容器环境变量里，前端拿不到
const INGEST_SYSTEM_KEY = process.env.INGEST_SYSTEM_KEY || 'jishika-ingest-2026';

// 会员码：8 位 Crockford（无 I L O U），与 membership.genMemberCode 字符集一致
const MEMBER_CODE_RE = /^[0-9A-HJKMNPQRSTVWXYZ]{8}$/;

function uid(prefix = 'card') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function nowText() {
  const date = new Date();
  const pad = (n) => `${n}`.padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 管理员判定：同 membership.isAdmin（admins 集合仅服务端/控制台可写）
async function isAdmin(openid) {
  try {
    const res = await db.collection('admins').where({ openid }).limit(1).get();
    return !!(res.data && res.data.length);
  } catch (err) {
    console.warn('[isAdmin] 查询失败', err.message || err);
    return false;
  }
}

// 待认领区：未绑定/非会员/不支持类型的消息都存这里，不丢不串，后续可回放认领
async function savePending({ externalUserid, msgType, content, msgId, msgTime, reason }) {
  try {
    await db.collection(PENDING).add({
      data: {
        externalUserid,
        msgType: msgType || 'text',
        content: content || '',
        msgId: msgId || '',
        msgTime: msgTime || 0,
        reason,
        createdAt: Date.now()
      }
    });
  } catch (e) {
    console.error('[savePending] 写入失败', e);
  }
}

// 写消息中心通知；失败仅打日志
async function writeMessage(openid, { title, content, cardId }) {
  try {
    await db.collection(MESSAGES).add({
      data: {
        _openid: openid,
        type: 'wecom',
        title,
        content: content || '',
        cardId: cardId || '',
        requestId: '',
        read: false,
        createdAt: Date.now()
      }
    });
  } catch (e) {
    console.error('[writeMessage] 写入失败', e);
  }
}

// 会员状态判定：lifetime 恒 active；月/年卡看 expireAt
function membershipActive(user) {
  const m = user && user.membership;
  if (!m || !m.expireAt) return false;
  if (m.plan === 'lifetime') return true;
  return m.expireAt > Date.now();
}

// 拉取游标读写（wecomArchiveState 集合，单行 _id='main'）：
// 容器经 HTTP 触发器调 getSeq/saveSeq，替代容器侧 SDK 直连数据库（容器无密钥）
const STATE_COL = 'wecomArchiveState';
const STATE_ID = 'main';

async function handleSeq(event) {
  if (event.action === 'getSeq') {
    try {
      const res = await db.collection(STATE_COL).doc(STATE_ID).get();
      return { code: 0, data: { seq: (res.data && res.data.seq) || 0 } };
    } catch (e) {
      return { code: 0, data: { seq: 0 } }; // 文档不存在视为首轮
    }
  }
  const seq = Number(event.seq) || 0;
  const data = { seq, updatedAt: Date.now() };
  // 微信云数据库 update 不存在的文档不抛错（stats.updated=0），必须显式判断再补 add
  const r = await db.collection(STATE_COL).doc(STATE_ID).update({ data });
  if (!r.stats || !r.stats.updated) {
    await db.collection(STATE_COL).add({ data: { _id: STATE_ID, ...data } });
  }
  return { code: 0, data: { seq } };
}

exports.main = async (event) => {
  // HTTP 触发器适配：容器经 HTTP 网关调用时，参数在 body（JSON 字符串）里
  if (event && typeof event.body === 'string') {
    try { Object.assign(event, JSON.parse(event.body)); } catch (e) { /* body 非 JSON 忽略 */ }
  }
  console.log('[wecomIngest] 收到请求', JSON.stringify({ action: event.action, msgType: event.msgType }));

  // 游标读写：仅供存档容器凭 systemKey 调用（HTTP 触发器通道，容器不走 SDK 鉴权）
  if (event.action === 'getSeq' || event.action === 'saveSeq') {
    if ((event.systemKey || '') !== INGEST_SYSTEM_KEY) {
      return { code: -1, message: '无权限' };
    }
    return await handleSeq(event);
  }

  // 测试垃圾清理：删除本人全部 source='wecom' 的记事卡（游标失效期间重复成卡的清理用，仅管理员）
  if (event.action === 'cleanup') {
    const opid = cloud.getWXContext().OPENID;
    if (!opid || !(await isAdmin(opid))) {
      return { code: -1, message: '无权限' };
    }
    const r = await db.collection(CARDS).where({ creatorId: opid, source: 'wecom' }).remove();
    return { code: 0, data: { removed: (r.stats && r.stats.removed) || 0 } };
  }

  if (event.action !== 'ingest') {
    return { code: -1, message: '未知 action' };
  }

  // 鉴权：管理员（管理页模拟）或 systemKey（存档容器）
  const openid = cloud.getWXContext().OPENID;
  const byKey = (event.systemKey || '') === INGEST_SYSTEM_KEY;
  if (!byKey) {
    if (!openid || !(await isAdmin(openid))) {
      return { code: -1, message: '无权限' };
    }
  }

  const externalUserid = (event.externalUserid || '').trim();
  const msgType = (event.msgType || 'text').trim();
  const content = (event.content || '').trim();
  if (!externalUserid) {
    return { code: -1, message: '缺少 externalUserid' };
  }

  try {
    // 首期仅文本入卡；语音/图片/聊天记录由容器侧后续接入（语音需先拉媒体文件转 ASR）
    if (msgType !== 'text' || !content) {
      await savePending({ externalUserid, msgType, content, msgId: event.msgId, msgTime: event.msgTime, reason: 'unsupported' });
      return { code: 0, data: { result: 'pending', reason: 'unsupported' } };
    }

    const userRes = await db.collection(USERS).where({ externalUserid }).limit(1).get();
    const user = userRes.data && userRes.data[0];

    // 未绑定：内容是会员码则走绑定（互调 membership.bindByCode，与存档识别同路径）
    if (!user) {
      if (MEMBER_CODE_RE.test(content.toUpperCase())) {
        const bindRes = await cloud.callFunction({
          name: 'membership',
          data: { action: 'bindByCode', code: content.toUpperCase(), externalUserid }
        });
        const r = (bindRes && bindRes.result) || {};
        if (r.code === 0) {
          return { code: 0, data: { result: 'bound', openidMasked: r.data && r.data.openidMasked } };
        }
        // 码无效或冲突：存待认领，人工跟进
        await savePending({ externalUserid, msgType, content, msgId: event.msgId, msgTime: event.msgTime, reason: 'bind_failed' });
        return { code: 0, data: { result: 'pending', reason: 'bind_failed', message: r.message } };
      }
      await savePending({ externalUserid, msgType, content, msgId: event.msgId, msgTime: event.msgTime, reason: 'unbound' });
      return { code: 0, data: { result: 'pending', reason: 'unbound' } };
    }

    // 已绑定但会员未开通/已过期：权益校验在服务端，消息存待认领不丢
    if (!membershipActive(user)) {
      await savePending({ externalUserid, msgType, content, msgId: event.msgId, msgTime: event.msgTime, reason: 'notMember' });
      return { code: 0, data: { result: 'pending', reason: 'notMember' } };
    }

    // 防护：已绑定用户再发自己的会员码（重发/游标重放），直接忽略不成卡
    if (user.memberCode && content.toUpperCase() === user.memberCode) {
      return { code: 0, data: { result: 'ignored', reason: 'own_member_code' } };
    }

    // 前缀强制覆盖：「灵感」/「#灵感」开头强制进灵感库，「记事」/「#记事」开头强制进记事卡
    // （AI kind 判定的显式纠偏通道；剥掉前缀再整理）
    let forceKind = '';
    let text = content;
    const prefixMatch = text.match(/^[#＃]?(灵感|记事)[:：\s]?/);
    if (prefixMatch) {
      forceKind = prefixMatch[1] === '灵感' ? 'inspire' : 'note';
      text = text.slice(prefixMatch[0].length).trim();
    }
    if (!text) {
      return { code: -1, message: '剥除前缀后内容为空' };
    }

    // AI 整理成卡：parseContext 失败时原文兜底成卡（标题截 15 字），保证"不丢"
    let parsed = null;
    try {
      const parseRes = await cloud.callFunction({
        name: 'parseContext',
        data: { action: 'parseText', text }
      });
      if (parseRes.result && parseRes.result.code === 0) parsed = parseRes.result.data;
    } catch (e) {
      console.warn('[ingest] parseContext 调用失败', e.message || e);
    }

    // 分流：前缀 > AI kind > 默认 note（偏置记事：宁可错放，不漏事项）
    const kind = forceKind || (parsed && parsed.kind) || 'note';

    // 灵感库：互调 inspireCard.ingestSpark 按主题归集（追加进匹配卡或新建），碎片存原文
    if (kind === 'inspire') {
      const sparkRes = await cloud.callFunction({
        name: 'inspireCard',
        data: { action: 'ingestSpark', openid: user._openid, text, source: msgType, systemKey: INGEST_SYSTEM_KEY }
      });
      const sr = (sparkRes && sparkRes.result) || {};
      if (sr.code !== 0) {
        await savePending({ externalUserid, msgType, content, msgId: event.msgId, msgTime: event.msgTime, reason: 'inspire_failed' });
        return { code: 0, data: { result: 'pending', reason: 'inspire_failed', message: sr.message } };
      }
      const sparkTitle = (sr.data && sr.data.title) || (text.length > 15 ? text.slice(0, 15) + '…' : text);
      await writeMessage(user._openid, {
        title: '已沉淀到灵感库',
        content: `《${sparkTitle}》${sr.data && sr.data.matched ? '（归入已有主题）' : '（新建灵感卡）'}`,
        cardId: '' // 灵感卡 id 不是记事卡 id，不留 cardId 防止消息中心跳错页
      });
      return { code: 0, data: { result: 'inspire', title: sparkTitle, matched: !!(sr.data && sr.data.matched) } };
    }

    const now = Date.now();
    const title = (parsed && parsed.title) || (text.length > 15 ? text.slice(0, 15) + '…' : text);

    // deadline 二次兜底：主解析没给日期但文本有明显时间意图时，单跑一次极简日期提取
    let deadline = (parsed && parsed.deadline) || '';
    if (!deadline && /(提醒|明天|明早|后天|今天|今晚|下周|周[一二三四五六日天末]|星期[一二三四五六日天]|\d{1,2}\s*点|\d{1,2}\s*月|\d{1,2}\s*[日号]|早上|上午|中午|下午|晚上|月底|周末)/.test(text)) {
      try {
        const dr = await cloud.callFunction({ name: 'parseContext', data: { action: 'parseDeadline', text } });
        if (dr.result && dr.result.code === 0 && dr.result.data) {
          deadline = dr.result.data.deadline || '';
        }
      } catch (e) {
        console.warn('[ingest] parseDeadline 兜底失败', e.message || e);
      }
    }

    const card = {
      id: uid(),
      title,
      desc: (parsed && parsed.desc) || text,
      keyPoints: (parsed && parsed.keyPoints) || [],
      theme: (parsed && parsed.theme) || 'default',
      // 截止/提醒日期：sendReminder 定时任务扫到期卡推订阅消息（含二次兜底提取）
      deadline,
      status: 'draft',
      creatorId: user._openid,
      helperIds: [],
      isNetworkVisible: true,
      source: 'wecom',
      attachmentFileIDs: [],
      files: [],
      createdAt: now,
      updatedAt: now,
      updatedText: nowText()
    };
    await db.collection(CARDS).add({ data: card });

    await writeMessage(user._openid, {
      title: '已记成卡片',
      content: `《${title}》已存为草稿，去首页确认`,
      cardId: card.id
    });

    return { code: 0, data: { result: 'card', cardId: card.id, title, aiParsed: !!parsed } };
  } catch (err) {
    console.error('[wecomIngest] 错误', err);
    return { code: -1, message: '云函数内部错误: ' + (err.message || JSON.stringify(err)) };
  }
};
