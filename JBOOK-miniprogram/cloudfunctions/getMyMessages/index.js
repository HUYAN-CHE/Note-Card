const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// 消息中心：拉取当前用户收件箱（按时间倒序，最多 50 条）+ 未读数
// action: 'unread' 时只返回未读数（互助页胶囊角标轻量调用）
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { code: -1, message: '未获取到用户身份' };
  }

  const messages = db.collection('messages');

  try {
    const countRes = await messages
      .where({ _openid: openid, read: false })
      .count();
    const unreadCount = countRes.total || 0;

    if (event.action === 'unread') {
      return { code: 0, data: { unreadCount } };
    }

    const res = await messages
      .where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const list = (res.data || []).map((item) => ({
      _id: item._id,
      type: item.type || '',
      title: item.title || '',
      content: item.content || '',
      cardId: item.cardId || '',
      requestId: item.requestId || '',
      read: !!item.read,
      createdAt: item.createdAt || 0
    }));

    return { code: 0, data: { list, unreadCount } };
  } catch (error) {
    return { code: -9, message: error.message || '获取消息失败' };
  }
};
