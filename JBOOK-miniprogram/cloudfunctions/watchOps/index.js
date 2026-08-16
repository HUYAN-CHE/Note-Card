const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

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

// 写消息到收件箱；失败仅打日志，不影响主流程
async function writeMessage(openid, type, { title, content, cardId }) {
  try {
    if (!openid) return;
    await db.collection('messages').add({
      data: {
        _openid: openid,
        type,
        title,
        content: content || '',
        cardId: cardId || '',
        requestId: '',
        read: false,
        createdAt: Date.now()
      }
    });
  } catch (e) {
    console.error('writeMessage error', e);
  }
}

// 建立/更新双向人脉关系；失败仅打日志，不影响主流程
async function upsertRelationship(ownerId, contactId, degree, source) {
  try {
    const res = await db.collection('relationships')
      .where({ ownerId, contactId })
      .limit(1)
      .get();

    const now = Date.now();

    if (res.data && res.data[0] && res.data[0]._id) {
      const exist = res.data[0];
      await db.collection('relationships').doc(exist._id).update({
        data: {
          // 关系度数只降不升（一度优先于二度）
          degree: degree < exist.degree ? degree : exist.degree,
          lastInteractAt: now,
          interactCount: _.inc(1),
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
          interactCount: 1,
          lastInteractAt: now,
          createdAt: now,
          updatedAt: now
        }
      });
    }
  } catch (e) {
    console.error('upsertRelationship error', e);
  }
}

// action: acceptWatch —— 落地页「打开提醒」后批量留意卡片
// 入参：{ refs: ['9K4X2Q', ...], inviter: '邀请人openid（可空）' }
async function acceptWatch(openid, event) {
  const refs = Array.isArray(event.refs) ? event.refs.filter(Boolean) : [];
  if (refs.length === 0) {
    return { code: -2, message: '缺少卡片短码' };
  }
  const inviter = event.inviter || '';

  let watched = 0;
  let already = 0;
  const watchedCards = [];
  let actorName = '';

  for (const refCode of refs) {
    try {
      const cardRes = await db.collection('cards')
        .where({ refCode })
        .limit(1)
        .get();
      const card = cardRes.data && cardRes.data[0];
      // 卡不存在：跳过，不计数
      if (!card) continue;

      const reminderSetBy = Array.isArray(card.reminderSetBy) ? card.reminderSetBy : [];
      // 幂等：已留意过的卡只计入 already，不重复写
      if (reminderSetBy.includes(openid)) {
        already++;
        continue;
      }

      // 卡片 reminderSetBy 追加当前用户
      await db.collection('cards').doc(card._id).update({
        data: {
          reminderSetBy: _.addToSet(openid),
          updatedAt: Date.now()
        }
      });

      if (!actorName) {
        const actor = await getActorProfile(openid);
        actorName = actor.actorName;
      }

      // 协作记录：开始留意
      await logActivity(card.id, openid, 'watch', '开始留意这张卡');

      // 建立人脉关系：留意人 ↔ 关系对象（一度）
      // inviter 为空、与卡主相同、或是我自己时，与卡主建立关系
      const target = (!inviter || inviter === card.creatorId || inviter === openid)
        ? card.creatorId
        : inviter;
      if (target && target !== openid) {
        await upsertRelationship(openid, target, 1, 'watch');
        await upsertRelationship(target, openid, 1, 'watch');
      }

      // 站内信通知卡主（卡主本人留意时不打扰自己）
      if (card.creatorId && card.creatorId !== openid) {
        await writeMessage(card.creatorId, 'watch', {
          title: '有人开始留意你的卡',
          content: `${actorName} 开始留意《${card.title || ''}》`,
          cardId: card.id
        });
      }

      watched++;
      watchedCards.push({ id: card.id, title: card.title || '' });
    } catch (e) {
      // 单张卡处理失败不阻塞其余卡
      console.error('acceptWatch card error', refCode, e);
    }
  }

  // 订阅额度：每张成功留意的卡累计一条推送额度
  if (watched > 0) {
    try {
      const users = db.collection('users');
      const res = await users.where({ _openid: openid }).limit(1).get();
      const user = res.data && res.data[0];
      if (user) {
        await users.doc(user._id).update({
          data: { subscribeCount: _.inc(watched) }
        });
      } else {
        // 云函数端 add 不会自动填充 _openid，必须显式写入
        await users.add({
          data: {
            _openid: openid,
            subscribeCount: watched,
            reminderEnabled: false,
            createdAt: db.serverDate()
          }
        });
      }
    } catch (e) {
      console.error('subscribeCount update error', e);
    }
  }

  return {
    code: 0,
    data: { watched, already, cards: watchedCards }
  };
}

// action: addNote —— 关注者/协助者/卡主补充进度说明
// 入参：{ cardId, content }（content ≤200 字）
async function addNote(openid, event) {
  const cardId = event.cardId;
  if (!cardId) {
    return { code: -2, message: '缺少卡片 ID' };
  }

  const content = (event.content || '').trim();
  if (!content) {
    return { code: -2, message: '说明内容不能为空' };
  }
  if (content.length > 200) {
    return { code: -2, message: '说明内容不能超过 200 字' };
  }

  const cardRes = await db.collection('cards')
    .where({ id: cardId })
    .limit(1)
    .get();
  const card = cardRes.data && cardRes.data[0];
  if (!card) {
    return { code: -3, message: '卡片不存在' };
  }

  // 权限：仅卡主/协助者/已留意的人可补充说明
  const helperIds = Array.isArray(card.helperIds) ? card.helperIds : [];
  const reminderSetBy = Array.isArray(card.reminderSetBy) ? card.reminderSetBy : [];
  const allowed = card.creatorId === openid
    || helperIds.includes(openid)
    || reminderSetBy.includes(openid);
  if (!allowed) {
    return { code: -4, message: '无权限操作' };
  }

  // 协作记录：补充说明
  await logActivity(cardId, openid, 'note', content);

  // 站内信通知卡主（本人操作时不发）
  if (card.creatorId && card.creatorId !== openid) {
    const actor = await getActorProfile(openid);
    await writeMessage(card.creatorId, 'note', {
      title: `${actor.actorName} 补充了说明`,
      content: content.slice(0, 50),
      cardId
    });
  }

  return { code: 0, message: 'success' };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { code: -1, message: '未获取到用户身份' };
  }

  try {
    if (event.action === 'acceptWatch') {
      return await acceptWatch(openid, event);
    }
    if (event.action === 'addNote') {
      return await addNote(openid, event);
    }
    return { code: -2, message: '未知操作' };
  } catch (error) {
    return { code: -5, message: error.message || '操作失败' };
  }
};
