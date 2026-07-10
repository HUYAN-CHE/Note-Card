const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

function getInitial(name) {
  if (!name) return '?';
  return name.trim().charAt(0);
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { code: -1, message: '未获取到用户身份' };
  }

  const { id } = event;
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

    const isCreator = card.creatorId === openid;
    const isHelper = Array.isArray(card.helperIds) && card.helperIds.includes(openid);
    const isNetworkVisible = card.isNetworkVisible === true;

    // 权限判定
    let role = 'stranger';
    if (isCreator) {
      role = 'creator';
    } else if (isHelper) {
      role = 'helper';
    } else if (isNetworkVisible) {
      role = 'network';
    } else {
      return { code: -4, message: '没有权限查看该卡片' };
    }

    // 查询创建者信息
    const creatorRes = await db.collection('users')
      .where({ _openid: card.creatorId })
      .limit(1)
      .get();
    const creatorUser = creatorRes.data && creatorRes.data[0];
    const creatorName = creatorUser ? creatorUser.nickName : '未知用户';

    // 查询协助者信息
    const helperIds = Array.isArray(card.helperIds) ? card.helperIds.filter(Boolean) : [];
    let helpers = [];
    if (helperIds.length) {
      const helperRes = await db.collection('users')
        .where({ _openid: db.command.in(helperIds) })
        .limit(50)
        .get();
      const helperMap = new Map();
      (helperRes.data || []).forEach((user) => {
        helperMap.set(user._openid, user);
      });
      helpers = helperIds.map((hid) => {
        const user = helperMap.get(hid) || {};
        return {
          id: hid,
          nickname: user.nickName || '未知用户',
          avatar: user.avatarUrl || '',
          initial: user.initial || getInitial(user.nickName)
        };
      });
    }

    const data = {
      ...card,
      role,
      isCreator,
      isHelper,
      isNetworkView: role === 'network',
      creator: {
        id: card.creatorId,
        nickname: creatorName,
        avatar: creatorUser ? creatorUser.avatarUrl : '',
        initial: creatorUser ? creatorUser.initial || getInitial(creatorName) : '?'
      },
      helpers
    };

    return { code: 0, message: 'success', data };
  } catch (error) {
    return { code: -5, message: error.message || '查询失败' };
  }
};
