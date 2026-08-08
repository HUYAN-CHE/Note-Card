const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

// 订阅消息模板：待办事项提醒（模板编号 15788，办公类目）
// 字段：待办名称 thing4、截至时间 time25
const TEMPLATE_ID = '4P5CvHsMvxnRGmD3rksLdeo6iuBV6m1hOc0DVPFcqoY';
const TEMPLATE_PAGE = 'pages/home/home';

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

// 北京时间明天，格式 YYYY-MM-DD（与卡片 deadline 字段格式一致）
function getTomorrowStr() {
  const beijingNow = new Date(Date.now() + 8 * 3600 * 1000);
  const tomorrow = new Date(beijingNow.getTime() + 24 * 3600 * 1000);
  return `${tomorrow.getUTCFullYear()}-${pad2(tomorrow.getUTCMonth() + 1)}-${pad2(tomorrow.getUTCDate())}`;
}

function buildTemplateData(card) {
  return {
    // thing 类型最长 20 字符；time 类型需完整 yyyy-MM-dd HH:mm:ss
    thing4: { value: (card.title || '记事卡').slice(0, 20) },
    time25: { value: `${card.deadline} 23:59:59` }
  };
}

// 北京时间今天，格式 YYYY-MM-DD（与卡片 deadline 字段格式一致）
function getTodayStr() {
  const beijingNow = new Date(Date.now() + 8 * 3600 * 1000);
  return `${beijingNow.getUTCFullYear()}-${pad2(beijingNow.getUTCMonth() + 1)}-${pad2(beijingNow.getUTCDate())}`;
}

// 北京时间今天 0 点对应的时间戳（用于「当日是否已写过过期消息」防重）
function getBeijingTodayStart() {
  const beijingNow = new Date(Date.now() + 8 * 3600 * 1000);
  return Date.UTC(beijingNow.getUTCFullYear(), beijingNow.getUTCMonth(), beijingNow.getUTCDate()) - 8 * 3600 * 1000;
}

// 写消息到收件箱；失败仅打日志，不影响主流程
async function writeMessage(openid, type, { title, content, cardId, requestId }) {
  try {
    if (!openid) return;
    await db.collection('messages').add({
      data: {
        _openid: openid,
        type,
        title,
        content: content || '',
        cardId: cardId || '',
        requestId: requestId || '',
        read: false,
        createdAt: Date.now()
      }
    });
  } catch (e) {
    console.error('writeMessage error', e);
  }
}

// 过期卡扫描：deadline 已过且未完成的卡，给创建者+协助者写 card_expired 消息，
// 同一卡同一天只写一条（查 messages 是否已有同 cardId+type+当日记录）
async function notifyExpiredCards() {
  const todayStr = getTodayStr();
  const todayStart = getBeijingTodayStart();
  let notified = 0;

  const cardRes = await db.collection('cards')
    .where({
      deadline: _.lt(todayStr),
      status: _.neq('done')
    })
    .limit(100)
    .get();

  for (const card of cardRes.data || []) {
    if (!card.deadline) continue;

    const existRes = await db.collection('messages')
      .where({
        cardId: card.id,
        type: 'card_expired',
        createdAt: _.gte(todayStart)
      })
      .limit(1)
      .get();
    if (existRes.data && existRes.data[0]) continue;

    const recipients = [...new Set([card.creatorId, ...(card.helperIds || [])].filter(Boolean))];
    for (const openid of recipients) {
      await writeMessage(openid, 'card_expired', {
        title: '记事卡已过期',
        content: `记事卡「${card.title}」已过期`,
        cardId: card.id
      });
    }
    notified += 1;
  }

  return notified;
}

// 每日定时扫描：截止日期为明天的未完成卡片，给开启「临近提醒」
// 且仍有订阅额度的创建者/协助者提前一天推送提醒，每发一条额度 -1。
exports.main = async () => {
  if (!TEMPLATE_ID) {
    // 模板未配置也照常扫过期卡写站内消息
    let expiredNotified = 0;
    try {
      expiredNotified = await notifyExpiredCards();
    } catch (e) {
      console.error('notifyExpiredCards error', e);
    }
    return { code: 0, message: '订阅消息模板未配置，跳过发送', sent: 0, expiredNotified };
  }

  const tomorrowStr = getTomorrowStr();
  const users = db.collection('users');

  try {
    // 按 deadline 升序扫描：订阅额度不足时先推最急的卡
    const cardRes = await db.collection('cards')
      .where({
        deadline: tomorrowStr,
        status: _.neq('done')
      })
      .orderBy('deadline', 'asc')
      .limit(100)
      .get();

    const cards = cardRes.data || [];
    let sent = 0;

    for (const card of cards) {
      const recipients = [...new Set([card.creatorId, ...(card.helperIds || [])].filter(Boolean))];

      for (const openid of recipients) {
        const userRes = await users.where({ _openid: openid }).limit(1).get();
        const user = userRes.data && userRes.data[0];
        if (!user || !user.reminderEnabled || !(user.subscribeCount > 0)) {
          continue;
        }

        try {
          await cloud.openapi.subscribeMessage.send({
            touser: openid,
            templateId: TEMPLATE_ID,
            page: TEMPLATE_PAGE,
            data: buildTemplateData(card)
          });
          await users.doc(user._id).update({
            data: { subscribeCount: _.inc(-1) }
          });
          sent += 1;
          // 额度刚扣到 0：写站内消息引导重新订阅（consume action 无调用方，在此直接判断）
          if (user.subscribeCount - 1 === 0) {
            await writeMessage(openid, 'reminder', {
              title: '提醒额度已用完',
              content: '提醒额度已用完，重新订阅以继续接收提醒'
            });
          }
        } catch (e) {
          // 43101 等发送失败不扣额度，跳过该用户
          console.warn('sendReminder fail', openid, card._id, e);
        }
      }
    }

    // 过期卡扫描：给创建者+协助者写 card_expired 站内消息（同卡同日防重）；
    // 失败不影响提醒发送结果
    let expiredNotified = 0;
    try {
      expiredNotified = await notifyExpiredCards();
    } catch (e) {
      console.error('notifyExpiredCards error', e);
    }

    return {
      code: 0,
      message: `扫描 ${cards.length} 张卡片，发送 ${sent} 条提醒；${expiredNotified} 张过期卡已写消息`,
      sent,
      expiredNotified
    };
  } catch (e) {
    return { code: -1, message: e.message || '发送失败' };
  }
};
