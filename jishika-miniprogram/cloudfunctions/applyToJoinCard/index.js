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

  const { cardId, intermediaryId, note = '' } = event;

  if (!cardId) {
    return { code: -2, message: '缺少卡片 ID' };
  }

  // intermediaryId 可选：从互助页引荐时传入，直接申请时可为空

  try {
    const cardRes = await db.collection('cards')
      .where({ id: cardId })
      .limit(1)
      .get();

    const card = cardRes.data && cardRes.data[0];
    if (!card) {
      return { code: -4, message: '卡片不存在' };
    }

    if (!card.isNetworkVisible) {
      return { code: -5, message: '该卡片未开启网络可见' };
    }

    if (card.creatorId === openid) {
      return { code: -6, message: '不能申请加入自己的卡片' };
    }

    const helperIds = Array.isArray(card.helperIds) ? card.helperIds : [];
    if (helperIds.includes(openid)) {
      return { code: -7, message: '已经是协助者' };
    }

    // 检查是否已有待审申请
    const existRes = await db.collection('joinRequests')
      .where({
        cardId,
        applicantId: openid,
        status: 'pending'
      })
      .limit(1)
      .get();

    if (existRes.data && existRes.data[0]) {
      return { code: -8, message: '已有待审申请' };
    }

    const now = Date.now();
    const res = await db.collection('joinRequests').add({
      data: {
        cardId,
        applicantId: openid,
        intermediaryId: intermediaryId || '',
        note: note.trim(),
        status: 'pending',
        createdAt: now,
        updatedAt: now
      }
    });

    return {
      code: 0,
      message: 'success',
      data: {
        requestId: res._id
      }
    };
  } catch (error) {
    return { code: -9, message: error.message || '申请失败' };
  }
};
