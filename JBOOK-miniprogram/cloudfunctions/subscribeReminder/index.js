const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

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

// 订阅消息额度累计：
// - 用户每次授权订阅消息，前端调用本函数给 users.subscribeCount +1
// - sendReminder 发送一条提醒则 -1，额度即剩余可推送条数
// - 可同时透传 reminderEnabled 保存「临近提醒」开关状态
exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { code: -1, message: '未获取到用户身份' };
  }

  const action = event.action || 'subscribe';
  const hasReminderPref = typeof event.reminderEnabled === 'boolean';
  const users = db.collection('users');

  try {
    const res = await users.where({ _openid: openid }).limit(1).get();
    const user = res.data && res.data[0];
    const count = user && user.subscribeCount ? user.subscribeCount : 0;

    if (action === 'get') {
      return {
        code: 0,
        data: {
          subscribed: count > 0,
          count,
          reminderEnabled: user ? !!user.reminderEnabled : false,
          lastSubscribedAt: user && user.lastSubscribedAt ? user.lastSubscribedAt : null
        }
      };
    }

    if (action === 'consume') {
      if (!user || count <= 0) {
        return { code: 0, data: { subscribed: false, count: 0 } };
      }
      await users.doc(user._id).update({
        data: { subscribeCount: _.inc(-1) }
      });
      // 消息中心：额度刚扣到 0 时提示重新订阅
      if (count - 1 === 0) {
        await writeMessage(openid, 'reminder', {
          title: '提醒额度已用完',
          content: '提醒额度已用完，重新订阅以继续接收提醒'
        });
      }
      return { code: 0, data: { subscribed: count - 1 > 0, count: count - 1 } };
    }

    // action === 'subscribe'：累计一次推送额度（并保存开关状态）
    // 只有按钮来源（source=button）才刷新 lastSubscribedAt，驱动首页按钮「今日已订阅」样式；
    // 开关/建卡引导只累加额度，不影响按钮每日重置
    const isButton = !event.source || event.source === 'button';
    if (user) {
      const data = {
        subscribeCount: _.inc(1)
      };
      // 开关状态只在显式传入时更新（首页开关拨动）；订阅动作只加额度，不擅自开开关
      if (hasReminderPref) {
        data.reminderEnabled = event.reminderEnabled;
      }
      if (isButton) {
        data.lastSubscribedAt = db.serverDate();
      }
      await users.doc(user._id).update({ data });
    } else {
      // 云函数端 add 不会自动填充 _openid（仅小程序端会），必须显式写入，
      // 否则产生 _openid 为空的脏记录，且后续 where({_openid}) 查不到会重复 add
      const data = {
        _openid: openid,
        subscribeCount: 1,
        reminderEnabled: hasReminderPref ? event.reminderEnabled : false,
        createdAt: db.serverDate()
      };
      if (isButton) {
        data.lastSubscribedAt = db.serverDate();
      }
      await users.add({ data });
    }

    // 订阅来源带 cardId 时（卡片详情页「订阅提醒」按钮），把当前用户记入该卡 reminderSetBy，
    // 按卡标记「我设置过提醒」，驱动详情页/列表的状态三态（提醒中/未设提醒）；
    // 独立 try/catch：失败仅打日志，不影响额度累计主流程
    if (event.cardId) {
      try {
        await db.collection('cards')
          .where({ id: event.cardId })
          .update({ data: { reminderSetBy: _.addToSet(openid) } });
      } catch (e) {
        console.error('reminderSetBy update error', e);
      }
    }

    // 消息中心：订阅成功提示（额度 +1 后）
    await writeMessage(openid, 'reminder', {
      title: '提醒订阅成功',
      content: '提醒订阅成功，截止日前会提醒你'
    });

    return { code: 0, data: { subscribed: true, count: count + 1 } };
  } catch (e) {
    return { code: -1, message: e.message || '订阅失败' };
  }
};
