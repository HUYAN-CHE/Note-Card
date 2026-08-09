const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// 写消息到收件箱；失败仅打日志，不影响主流程
async function writeMessage(openid, type, { title, content, cardId, requestId }) {
  try {
    if (!openid) return;
    await db.collection('messages').add({
      data: {
        _openid: openid,
        type,
        title,
        content: content || '',
        cardId: cardId || '',
        requestId: requestId || '',
        read: false,
        createdAt: Date.now()
      }
    });
  } catch (e) {
    console.error('writeMessage error', e);
  }
}

// 查用户昵称，无记录兜底「新朋友」
async function getNickname(openid) {
  try {
    const res = await db.collection('users')
      .where({ _openid: openid })
      .limit(1)
      .get();
    const user = res.data && res.data[0];
    return (user && user.nickName) || '新朋友';
  } catch (e) {
    return '新朋友';
  }
}

// 引荐人确认引荐：pending_intermediary -> pending，申请正式到达卡主
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { code: -1, message: '未获取到用户身份' };
  }

  const { requestId } = event;

  if (!requestId) {
    return { code: -2, message: '缺少申请 ID' };
  }

  try {
    const reqRes = await db.collection('joinRequests')
      .doc(requestId)
      .get();

    const request = reqRes.data;
    if (!request) {
      return { code: -3, message: '申请不存在' };
    }

    if (request.status !== 'pending_intermediary') {
      return { code: -4, message: '该申请不在待引荐状态' };
    }

    if (request.applicantId === openid) {
      return { code: -5, message: '不能引荐自己的申请' };
    }

    const cardRes = await db.collection('cards')
      .where({ id: request.cardId })
      .limit(1)
      .get();

    const card = cardRes.data && cardRes.data[0];
    if (!card) {
      return { code: -6, message: '卡片不存在' };
    }

    // 指定了引荐人时，只有 TA 本人可以引荐
    if (request.intermediaryId && request.intermediaryId !== openid) {
      return { code: -7, message: '只有指定引荐人可以引荐' };
    }

    // 引荐人必须是卡主的一度人脉
    const relRes = await db.collection('relationships')
      .where({ ownerId: card.creatorId, contactId: openid })
      .limit(1)
      .get();

    const rel = relRes.data && relRes.data[0];
    if (!rel || rel.degree !== 1) {
      return { code: -8, message: '只有卡主的一度人脉可以引荐' };
    }

    await db.collection('joinRequests').doc(requestId).update({
      data: { status: 'pending', updatedAt: Date.now() }
    });

    // 消息中心：引荐完成后通知创建者
    const [applicantName, intermediaryName] = await Promise.all([
      getNickname(request.applicantId),
      getNickname(openid)
    ]);
    await writeMessage(card.creatorId, 'join_request', {
      title: '朋友引荐了新伙伴',
      content: `${intermediaryName} 引荐 ${applicantName} 加入「${card.title}」，等你拍板`,
      cardId: request.cardId,
      requestId
    });

    return { code: 0, message: 'success', data: { applicantName, cardTitle: card.title || '' } };
  } catch (error) {
    return { code: -9, message: error.message || '引荐失败' };
  }
};
