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

const STATUS_TEXT = {
  draft: '待确认',
  todo: '待确认',
  doing: '进行中',
  done: '已完成'
};

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

// 把字段变更翻译成中文操作描述
function buildFieldDetails(patch) {
  const details = [];
  if (patch.title !== undefined) {
    const title = String(patch.title || '');
    details.push(`更新了标题为「${title.length > 12 ? `${title.slice(0, 12)}…` : title}」`);
  }
  if (patch.desc !== undefined) details.push('更新了需求描述');
  if (patch.keyPoints !== undefined) details.push('更新了重点内容');
  if (patch.status !== undefined) {
    details.push(`将状态改为 ${STATUS_TEXT[patch.status] || patch.status}`);
  }
  if (patch.deadline !== undefined) {
    details.push(patch.deadline ? `将截止日期改为 ${patch.deadline}` : '清除了截止日期');
  }
  return details;
}

// 写入协作记录；失败仅打日志，不影响主流程
async function logActivities(cardId, openid, action, details) {
  if (!details.length) return;
  try {
    const actor = await getActorProfile(openid);
    const createdAt = Date.now();
    await Promise.all(details.map((detail) => db.collection('cardActivities').add({
      data: {
        cardId,
        actorId: openid,
        actorName: actor.actorName,
        actorAvatar: actor.actorAvatar,
        action,
        detail,
        createdAt
      }
    })));
  } catch (e) {
    console.error('logActivities error', e);
  }
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

    await logActivities(id, openid, 'update_field', buildFieldDetails(safePatch));

    return { code: 0, message: 'success' };
  } catch (error) {
    return { code: -5, message: error.message || '更新失败' };
  }
};
