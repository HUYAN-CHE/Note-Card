const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

async function upsertRelationship(ownerId, contactId, degree, source) {
  const res = await db.collection('relationships')
    .where({ ownerId, contactId })
    .limit(1)
    .get();

  const now = Date.now();
  const data = {
    ownerId,
    contactId,
    degree,
    source,
    lastInteractAt: now,
    updatedAt: now
  };

  if (res.data && res.data[0] && res.data[0]._id) {
    const exist = res.data[0];
    await db.collection('relationships').doc(exist._id).update({
      data: {
        degree: degree < exist.degree ? degree : exist.degree,
        lastInteractAt: now,
        interactCount: db.command.inc(1),
        updatedAt: now
      }
    });
  } else {
    await db.collection('relationships').add({
      data: {
        ...data,
        interactCount: 1,
        createdAt: now
      }
    });
  }
}

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

    if (card.creatorId === openid) {
      return { code: -4, message: '创建者无需加入自己的卡片' };
    }

    const helperIds = Array.isArray(card.helperIds) ? card.helperIds : [];
    if (helperIds.includes(openid)) {
      return { code: 0, message: '已经是协助者' };
    }

    // 更新卡片 helperIds
    await db.collection('cards').doc(card._id).update({
      data: {
        helperIds: [...helperIds, openid],
        updatedAt: Date.now()
      }
    });

    // 建立双向一度关系
    await upsertRelationship(openid, card.creatorId, 1, 'invite');
    await upsertRelationship(card.creatorId, openid, 1, 'invite');

    return { code: 0, message: 'success' };
  } catch (error) {
    return { code: -5, message: error.message || '加入失败' };
  }
};
