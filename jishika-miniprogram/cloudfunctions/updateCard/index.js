const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

function nowText() {
  const date = new Date();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { code: -1, message: '未获取到用户身份' };
  }

  const { id, patch = {} } = event;

  if (!id) {
    return { code: -2, message: '缺少卡片 ID' };
  }

  try {
    const cardRes = await db.collection('cards')
      .where({ id })
      .limit(1)
      .get();

    const card = cardRes.data && cardRes.data[0];
    if (!card) {
      return { code: -3, message: '卡片不存在' };
    }

    // 权限校验：仅创作者或协助者可更新
    const isCreator = card.creatorId === openid;
    const isHelper = Array.isArray(card.helperIds) && card.helperIds.includes(openid);
    if (!isCreator && !isHelper) {
      return { code: -4, message: '没有权限更新该卡片' };
    }

    // 不允许修改创建者和 ID
    const safePatch = { ...patch };
    delete safePatch._id;
    delete safePatch.id;
    delete safePatch.creatorId;
    delete safePatch.createdAt;

    const updateData = {
      ...safePatch,
      updatedAt: Date.now(),
      updatedText: nowText()
    };

    await db.collection('cards')
      .doc(card._id)
      .update({ data: updateData });

    return { code: 0, message: 'success' };
  } catch (error) {
    return { code: -5, message: error.message || '更新失败' };
  }
};
