const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// 读取操作者昵称头像快照，写入协作记录时免 join
async function getActorProfile(openid) {
  try {
    const res = await db.collection('users')
      .where({ _openid: openid })
      .limit(1)
      .get();
    const user = res.data && res.data[0];
    return {
      actorName: (user && user.nickName) || '未知用户',
      actorAvatar: (user && user.avatarUrl) || ''
    };
  } catch (e) {
    return { actorName: '未知用户', actorAvatar: '' };
  }
}

// 写入协作记录；失败仅打日志，不影响主流程
async function logActivity(cardId, openid, action, detail) {
  try {
    const actor = await getActorProfile(openid);
    await db.collection('cardActivities').add({
      data: {
        cardId,
        actorId: openid,
        actorName: actor.actorName,
        actorAvatar: actor.actorAvatar,
        action,
        detail,
        createdAt: Date.now()
      }
    });
  } catch (e) {
    console.error('logActivity error', e);
  }
}

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

    await logActivity(cardId, openid, 'join', '通过邀请加入协作');

    return { code: 0, message: 'success' };
  } catch (error) {
    return { code: -5, message: error.message || '加入失败' };
  }
};
