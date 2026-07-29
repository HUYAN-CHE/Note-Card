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
      if (hasReminderPref) {
        data.reminderEnabled = event.reminderEnabled;
      }
      if (isButton) {
        data.lastSubscribedAt = db.serverDate();
      }
      await users.doc(user._id).update({ data });
    } else {
      // 注意：_openid 是系统保留字段不允许写入，add 时云库自动填充
      const data = {
        subscribeCount: 1,
        reminderEnabled: hasReminderPref ? event.reminderEnabled : false,
        createdAt: db.serverDate()
      };
      if (isButton) {
        data.lastSubscribedAt = db.serverDate();
      }
      await users.add({ data });
    }
    return { code: 0, data: { subscribed: true, count: count + 1 } };
  } catch (e) {
    return { code: -1, message: e.message || '订阅失败' };
  }
};
