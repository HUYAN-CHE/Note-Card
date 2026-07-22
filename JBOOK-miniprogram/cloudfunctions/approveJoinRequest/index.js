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
        ownerId,
        contactId,
        degree,
        source,
        lastInteractAt: now,
        interactCount: 1,
        createdAt: now,
        updatedAt: now
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

  const { requestId, status = 'approved' } = event;

  if (!requestId) {
    return { code: -2, message: '缺少申请 ID' };
  }

  if (status !== 'approved' && status !== 'rejected') {
    return { code: -3, message: '状态不合法' };
  }

  try {
    const reqRes = await db.collection('joinRequests')
      .doc(requestId)
      .get();

    const request = reqRes.data;
    if (!request) {
      return { code: -4, message: '申请不存在' };
    }

    if (request.status !== 'pending') {
      return { code: -5, message: '申请已处理' };
    }

    const cardRes = await db.collection('cards')
      .where({ id: request.cardId })
      .limit(1)
      .get();

    const card = cardRes.data && cardRes.data[0];
    if (!card) {
      return { code: -6, message: '卡片不存在' };
    }

    if (card.creatorId !== openid) {
      return { code: -7, message: '只有创作者可以审批' };
    }

    const now = Date.now();

    if (status === 'rejected') {
      await db.collection('joinRequests').doc(requestId).update({
        data: { status: 'rejected', updatedAt: now }
      });
      return { code: 0, message: 'success' };
    }

    // 通过：更新卡片 helperIds
    const helperIds = Array.isArray(card.helperIds) ? card.helperIds : [];
    if (!helperIds.includes(request.applicantId)) {
      await db.collection('cards').doc(card._id).update({
        data: {
          helperIds: [...helperIds, request.applicantId],
          updatedAt: now
        }
      });
    }

    // 建立二度关系
    await upsertRelationship(openid, request.applicantId, 2, 'join_request');
    await upsertRelationship(request.applicantId, openid, 2, 'join_request');

    // 更新申请状态
    await db.collection('joinRequests').doc(requestId).update({
      data: { status: 'approved', updatedAt: now }
    });

    // 记录申请人的加入动作（操作者是申请者本人）
    await logActivity(request.cardId, request.applicantId, 'join', '申请通过，加入协作');

    return { code: 0, message: 'success' };
  } catch (error) {
    return { code: -8, message: error.message || '审批失败' };
  }
};
