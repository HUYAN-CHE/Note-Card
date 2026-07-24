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

// 每日定时扫描：截止日期为明天的未完成卡片，给开启「临近提醒」
// 且仍有订阅额度的创建者/协助者提前一天推送提醒，每发一条额度 -1。
exports.main = async () => {
  if (!TEMPLATE_ID) {
    return { code: 0, message: '订阅消息模板未配置，跳过发送', sent: 0 };
  }

  const tomorrowStr = getTomorrowStr();
  const users = db.collection('users');

  try {
    const cardRes = await db.collection('cards')
      .where({
        deadline: tomorrowStr,
        status: _.neq('done')
      })
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
        } catch (e) {
          // 43101 等发送失败不扣额度，跳过该用户
          console.warn('sendReminder fail', openid, card._id, e);
        }
      }
    }

    return { code: 0, message: `扫描 ${cards.length} 张卡片，发送 ${sent} 条提醒`, sent };
  } catch (e) {
    return { code: -1, message: e.message || '发送失败' };
  }
};
