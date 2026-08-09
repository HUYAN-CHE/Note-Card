const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

function getCardDesc(card) {
  if (card.desc) return card.desc;
  if (card.keyPoints && card.keyPoints.length) return card.keyPoints.join(' · ');
  return '暂无描述';
}

// 北京时间今天（YYYY-MM-DD），与前端及 sendReminder 口径一致
function getToday() {
  const beijingNow = new Date(Date.now() + 8 * 3600 * 1000);
  return `${beijingNow.getUTCFullYear()}-${String(beijingNow.getUTCMonth() + 1).padStart(2, '0')}-${String(beijingNow.getUTCDate()).padStart(2, '0')}`;
}

// 已过期卡不在互助页展示（过期的事再申请也没意义）
function isExpired(card) {
  return !!(card.deadline && card.deadline < getToday());
}

// 展示状态：过期卡已被过滤，正常即「进行中」
function getCardStatus() {
  return '进行中';
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const helperOpenid = event.helperOpenid;

  // 返回结构：own=helper 本人的卡（一度直达），secondDegree=helper 人脉里我的二度卡
  const emptyData = { own: [], secondDegree: [] };

  if (!openid) {
    return { code: -1, message: '未获取到用户身份', data: emptyData };
  }

  if (!helperOpenid) {
    return { code: -2, message: '缺少 helperOpenid', data: emptyData };
  }

  try {
    // 1. 查询 helper 用户信息，两段展示都要用昵称
    const helperUser = await db.collection('users')
      .where({ _openid: helperOpenid })
      .limit(1)
      .get();
    const helperName = (helperUser.data && helperUser.data[0] && helperUser.data[0].nickName) || '朋友';

    // 2. helper 本人创建的、网络可见的卡（「TA 需要什么」段）
    const ownCardRes = await db.collection('cards')
      .where({
        creatorId: helperOpenid,
        isNetworkVisible: true
      })
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();

    const own = (ownCardRes.data || []).filter((card) => !isExpired(card)).map((card) => ({
      id: card.id,
      title: card.title || '未命名事项',
      desc: getCardDesc(card),
      creatorName: helperName,
      relation: '你的朋友',
      status: getCardStatus(card),
      creatorId: card.creatorId,
      helperOpenid
    }));

    // 3. 查询 helperOpenid 的一度人脉
    const helperRelRes = await db.collection('relationships')
      .where({
        ownerId: helperOpenid,
        degree: 1
      })
      .limit(200)
      .get();

    const helperContacts = (helperRelRes.data || [])
      .map((rel) => rel.contactId)
      .filter(Boolean);

    if (!helperContacts.length) {
      return { code: 0, message: 'success', data: { own, secondDegree: [] } };
    }

    // 4. 查询当前用户的一度人脉，用于排除
    const myRelRes = await db.collection('relationships')
      .where({
        ownerId: openid,
        degree: 1
      })
      .limit(200)
      .get();

    const myContacts = (myRelRes.data || [])
      .map((rel) => rel.contactId)
      .filter(Boolean);

    // 5. 计算二度人脉：helper 的联系人中，排除我和我的一度人脉
    const excludeSet = new Set([openid, ...myContacts]);
    const secondDegreeIds = helperContacts.filter((id) => !excludeSet.has(id));

    if (!secondDegreeIds.length) {
      return { code: 0, message: 'success', data: { own, secondDegree: [] } };
    }

    // 6. 查询二度人脉创建的、网络可见的卡（「TA 的朋友们需要什么」段）
    const cardRes = await db.collection('cards')
      .where({
        creatorId: _.in(secondDegreeIds),
        isNetworkVisible: true
      })
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();

    if (!cardRes.data || !cardRes.data.length) {
      return { code: 0, message: 'success', data: { own, secondDegree: [] } };
    }

    // 7. 查询创建者用户信息
    const creatorIds = Array.from(new Set(cardRes.data.map((card) => card.creatorId).filter(Boolean)));
    const userRes = await db.collection('users')
      .where({
        _openid: _.in(creatorIds)
      })
      .limit(200)
      .get();

    const userMap = new Map();
    (userRes.data || []).forEach((user) => {
      userMap.set(user._openid, user);
    });

    const secondDegree = cardRes.data.filter((card) => !isExpired(card)).map((card) => {
      const creator = userMap.get(card.creatorId) || {};
      const creatorName = creator.nickName || '朋友';
      return {
        id: card.id,
        title: card.title || '未命名事项',
        desc: getCardDesc(card),
        creatorName,
        relation: `${helperName}的朋友`,
        status: getCardStatus(card),
        creatorId: card.creatorId,
        helperOpenid
      };
    });

    return { code: 0, message: 'success', data: { own, secondDegree } };
  } catch (error) {
    return { code: -3, message: error.message || '查询失败', data: emptyData };
  }
};
