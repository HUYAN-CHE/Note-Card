const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { code: -1, message: '未获取到用户身份' };
  }

  const { cardId } = event;
  if (!cardId) {
    return { code: -2, message: '缺少卡片 ID' };
  }

  try {
    const cardRes = await db.collection('cards')
      .where({ id: cardId })
      .limit(1)
      .get();

    const card = cardRes.data && cardRes.data[0];
    if (!card) {
      return { code: -3, message: '卡片不存在' };
    }

    // 权限校验：仅创作者或协助者可查看协作记录
    const isCreator = card.creatorId === openid;
    const isHelper = Array.isArray(card.helperIds) && card.helperIds.includes(openid);
    if (!isCreator && !isHelper) {
      return { code: -4, message: '没有权限查看该卡片的协作记录' };
    }

    const res = await db.collection('cardActivities')
      .where({ cardId })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    return { code: 0, message: 'success', data: res.data || [] };
  } catch (error) {
    return { code: -5, message: error.message || '查询失败' };
  }
};
