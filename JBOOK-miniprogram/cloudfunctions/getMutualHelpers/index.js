const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

const COLORS = [
  '#4A90E2', '#7B61FF', '#FF9F43', '#FF6B81',
  '#2ECC71', '#1ABC9C', '#E74C3C', '#9B59B6', '#3498DB'
];

function getInitial(name) {
  if (!name) return '?';
  return name.trim().charAt(0);
}

function pickColor(seed) {
  let hash = 0;
  for (let i = 0; i < (seed || '').length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % COLORS.length;
  return COLORS[index];
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { code: -1, message: '未获取到用户身份', data: [] };
  }

  try {
    // 1. 查询我的一度人脉
    const relRes = await db.collection('relationships')
      .where({
        ownerId: openid,
        degree: 1
      })
      .orderBy('lastInteractAt', 'desc')
      .limit(200)
      .get();

    const contactIds = (relRes.data || [])
      .map((rel) => rel.contactId)
      .filter(Boolean);

    if (!contactIds.length) {
      return { code: 0, message: 'success', data: [] };
    }

    // 2. 查询用户资料
    const userRes = await db.collection('users')
      .where({
        _openid: _.in(contactIds)
      })
      .limit(200)
      .get();

    const userMap = new Map();
    (userRes.data || []).forEach((user) => {
      userMap.set(user._openid, user);
    });

    // 3. 组装结果
    const data = contactIds.map((contactId, index) => {
      const user = userMap.get(contactId) || {};
      const name = user.nickName || `用户${index + 1}`;
      return {
        id: contactId,
        openid: contactId,
        type: 'user',
        name,
        avatar: user.avatarUrl || '',
        color: user.color || pickColor(contactId),
        initial: user.initial || getInitial(name)
      };
    });

    return { code: 0, message: 'success', data };
  } catch (error) {
    return { code: -2, message: error.message || '查询失败', data: [] };
  }
};
