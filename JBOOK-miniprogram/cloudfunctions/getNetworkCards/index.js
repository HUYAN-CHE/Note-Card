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

function getCardStatus(card) {
  const map = {
    draft: '待确认',
    todo: '待确认',
    doing: '进行中',
    done: '已完成'
  };
  return map[card.status] || card.status || '进行中';
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const helperOpenid = event.helperOpenid;

  if (!openid) {
    return { code: -1, message: '未获取到用户身份', data: [] };
  }

  if (!helperOpenid) {
    return { code: -2, message: '缺少 helperOpenid', data: [] };
  }

  try {
    // 1. 查询 helperOpenid 的一度人脉
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
      return { code: 0, message: 'success', data: [] };
    }

    // 2. 查询当前用户的一度人脉，用于排除
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

    // 3. 计算二度人脉：helper 的联系人中，排除我和我的一度人脉
    const excludeSet = new Set([openid, ...myContacts]);
    const secondDegreeIds = helperContacts.filter((id) => !excludeSet.has(id));

    if (!secondDegreeIds.length) {
      return { code: 0, message: 'success', data: [] };
    }

    // 4. 查询二度人脉创建的、网络可见的卡
    const cardRes = await db.collection('cards')
      .where({
        creatorId: _.in(secondDegreeIds),
        isNetworkVisible: true
      })
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();

    if (!cardRes.data || !cardRes.data.length) {
      return { code: 0, message: 'success', data: [] };
    }

    // 5. 查询创建者用户信息
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

    // 6. 查询当前用户与 helperOpenid 的关系来源，用于展示
    const helperUser = await db.collection('users')
      .where({ _openid: helperOpenid })
      .limit(1)
      .get();
    const helperName = (helperUser.data && helperUser.data[0] && helperUser.data[0].nickName) || '朋友';

    const data = cardRes.data.map((card) => {
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

    return { code: 0, message: 'success', data };
  } catch (error) {
    return { code: -3, message: error.message || '查询失败', data: [] };
  }
};
