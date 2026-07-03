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
    // 1. 查询当前用户创建的所有卡片
    const cardRes = await db.collection('cards')
      .where({ creatorId: openid })
      .field({ helperIds: true })
      .limit(200)
      .get();

    const helperIdSet = new Set();
    (cardRes.data || []).forEach((card) => {
      (card.helperIds || []).forEach((id) => {
        if (id && id !== openid) helperIdSet.add(id);
      });
    });

    const helperIds = Array.from(helperIdSet);

    if (!helperIds.length) {
      return { code: 0, message: 'success', data: [] };
    }

    // 2. 查询 users 集合获取 helper 信息
    const userRes = await db.collection('users')
      .where({ openid: _.in(helperIds) })
      .limit(200)
      .get();

    const userMap = new Map();
    (userRes.data || []).forEach((user) => {
      userMap.set(user.openid, user);
    });

    // 3. 组装结果，users 集合里没有的用 openid 兜底
    const data = helperIds.map((helperOpenid, index) => {
      const user = userMap.get(helperOpenid) || {};
      const name = user.nickName || `用户${index + 1}`;
      return {
        id: helperOpenid,
        openid: helperOpenid,
        type: 'user',
        name,
        avatar: user.avatarUrl || '',
        color: user.color || pickColor(helperOpenid),
        initial: user.initial || getInitial(name)
      };
    });

    return { code: 0, message: 'success', data };
  } catch (error) {
    return { code: -2, message: error.message || '查询失败', data: [] };
  }
};
