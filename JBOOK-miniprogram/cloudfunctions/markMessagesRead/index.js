const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

// 消息中心：把当前用户的消息标记为已读
// 入参 { ids: [] } 标记指定消息；{ all: true } 标记全部未读（分批处理，避开批量上限）
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { code: -1, message: '未获取到用户身份' };
  }

  const messages = db.collection('messages');
  const ids = Array.isArray(event.ids) ? event.ids.filter(Boolean) : [];

  try {
    if (!event.all && ids.length === 0) {
      return { code: -2, message: '缺少要标记的消息' };
    }

    if (ids.length > 0) {
      // 指定消息：逐条置已读（收件箱最多 50 条，量小直接循环）
      const tasks = ids.map((id) =>
        messages
          .where({ _id: id, _openid: openid })
          .update({ data: { read: true } })
      );
      await Promise.all(tasks);
      return { code: 0, data: { marked: ids.length } };
    }

    // 全部已读：每批取 100 条未读逐条更新，直至没有未读
    let marked = 0;
    while (true) {
      const res = await messages
        .where({ _openid: openid, read: false })
        .limit(100)
        .get();
      const docs = res.data || [];
      if (!docs.length) break;
      const tasks = docs.map((doc) =>
        messages.doc(doc._id).update({ data: { read: true } })
      );
      await Promise.all(tasks);
      marked += docs.length;
      if (docs.length < 100) break;
    }

    return { code: 0, data: { marked } };
  } catch (error) {
    return { code: -9, message: error.message || '标记已读失败' };
  }
};
