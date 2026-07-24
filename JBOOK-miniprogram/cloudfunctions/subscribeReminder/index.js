const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

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
          reminderEnabled: user ? !!user.reminderEnabled : false
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
      return { code: 0, data: { subscribed: count - 1 > 0, count: count - 1 } };
    }

    // action === 'subscribe'：累计一次推送额度（并保存开关状态）
    if (user) {
      const data = {
        subscribeCount: _.inc(1),
        lastSubscribedAt: db.serverDate()
      };
      if (hasReminderPref) {
        data.reminderEnabled = event.reminderEnabled;
      }
      await users.doc(user._id).update({ data });
    } else {
      await users.add({
        data: {
          _openid: openid,
          subscribeCount: 1,
          reminderEnabled: hasReminderPref ? event.reminderEnabled : false,
          createdAt: db.serverDate(),
          lastSubscribedAt: db.serverDate()
        }
      });
    }
    return { code: 0, data: { subscribed: true, count: count + 1 } };
  } catch (e) {
    return { code: -1, message: e.message || '订阅失败' };
  }
};
