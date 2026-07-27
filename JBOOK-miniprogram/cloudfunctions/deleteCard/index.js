const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const { cardId } = event;

  if (!openid) {
    return { code: -1, message: '未获取到用户身份' };
  }
  if (!cardId) {
    return { code: -1, message: '缺少 cardId' };
  }

  try {
    // 按业务字段 id 查询（doc() 查的是数据库 _id）
    const res = await db.collection('cards').where({ id: cardId }).limit(1).get();
    const card = res.data && res.data[0];
    if (!card) {
      return { code: -1, message: '卡片不存在' };
    }
    if (card.creatorId !== openid) {
      return { code: -1, message: '只有创立者可以删除该卡片' };
    }

    await db.collection('cards').doc(card._id).remove();
    console.log('[deleteCard] 已删除', cardId);
    return { code: 0, data: { cardId } };
  } catch (err) {
    console.error('[deleteCard] 删除失败', err);
    return { code: -1, message: '删除失败: ' + (err.message || err) };
  }
};
