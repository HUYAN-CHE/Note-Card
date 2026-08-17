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
const _ = db.command;
const USERS = 'users';
const CARDS = 'cards';
const MESSAGES = 'messages';
const PENDING = 'wecomPending';

// 订阅消息模板：待办事项提醒（模板编号 15788，与 sendReminder 同一个）
// 成卡回执复用：thing4=已记成卡片《标题》，time25=截止时间（无 deadline 用成卡时间）
const TEMPLATE_ID = '4P5CvHsMvxnRGmD3rksLdeo6iuBV6m1hOc0DVPFcqoY';
const TEMPLATE_PAGE = 'pages/home/home';

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

// 成卡回执：用户有订阅额度则推一条「已记成卡片」，成功额度 -1；无额度静默（站内消息已兜底）
// 回执文案回显 AI 理解结果（标题+时间），私聊不能回话，纠错靠用户扫一眼回执
async function sendReceipt(user, card) {
  if (!(user.subscribeCount > 0)) return;
  const bj = new Date(Date.now() + 8 * 3600 * 1000);
  const pad = (n) => `${n}`.padStart(2, '0');
  const createdText = `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}:00`;
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: user._openid,
      templateId: TEMPLATE_ID,
      page: TEMPLATE_PAGE,
      data: {
        thing4: { value: `已记成卡片《${card.title}》`.slice(0, 20) },
        time25: { value: card.deadline ? `${card.deadline} 23:59:59` : createdText }
      }
    });
    await db.collection(USERS).doc(user._id).update({ data: { subscribeCount: _.inc(-1) } });
    // 额度刚扣到 0：站内消息引导充值（同 sendReminder 模式）
    if (user.subscribeCount - 1 === 0) {
      await writeMessage(user._openid, {
        title: '提醒额度已用完',
        content: '提醒额度已用完，去会员页充值以继续接收私聊回执与到期提醒'
      });
    }
  } catch (e) {
    // 43101 等发送失败不扣额度，不阻塞成卡
    console.warn('[sendReceipt] 发送失败', e.message || e);
  }
}

exports.main = async (event) => {
  console.log('[wecomIngest] 收到请求', JSON.stringify({ action: event.action, msgType: event.msgType }));

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

    // AI 整理成卡：parseContext 失败时原文兜底成卡（标题截 15 字），保证"不丢"
    let parsed = null;
    try {
      const parseRes = await cloud.callFunction({
        name: 'parseContext',
        data: { action: 'parseText', text: content }
      });
      if (parseRes.result && parseRes.result.code === 0) parsed = parseRes.result.data;
    } catch (e) {
      console.warn('[ingest] parseContext 调用失败', e.message || e);
    }

    const now = Date.now();
    const title = (parsed && parsed.title) || (content.length > 15 ? content.slice(0, 15) + '…' : content);
    const card = {
      id: uid(),
      title,
      desc: (parsed && parsed.desc) || content,
      keyPoints: (parsed && parsed.keyPoints) || [],
      theme: (parsed && parsed.theme) || 'default',
      // 截止/提醒日期：sendReminder 定时任务扫到期卡推订阅消息
      deadline: (parsed && parsed.deadline) || '',
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
      content: card.deadline
        ? `《${title}》已存为草稿，将于 ${card.deadline} 前提醒`
        : `《${title}》已存为草稿，未识别到时间，进小程序可补`,
      cardId: card.id
    });

    // 订阅消息回执：有额度才推，文案回显 AI 理解（标题+时间）
    await sendReceipt(user, card);

    return { code: 0, data: { result: 'card', cardId: card.id, title, aiParsed: !!parsed } };
  } catch (err) {
    console.error('[wecomIngest] 错误', err);
    return { code: -1, message: '云函数内部错误: ' + (err.message || JSON.stringify(err)) };
  }
};
