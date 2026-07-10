const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

function getInitial(name) {
  if (!name) return '我';
  return name.trim().charAt(0).toUpperCase() || '我';
}

function getStatusClass(status) {
  if (status === 'done') return 'done';
  if (status === 'todo') return 'todo';
  if (status === 'draft') return 'todo';
  return 'doing';
}

function getStatusText(status) {
  const map = {
    draft: '待确认',
    todo: '待确认',
    doing: '进行中',
    done: '已完成'
  };
  return map[status] || status || '进行中';
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { code: -1, message: '未获取到用户身份' };
  }

  try {
    // 1. 用户资料
    const userRes = await db.collection('users')
      .where({ _openid: openid })
      .limit(1)
      .get();

    const user = userRes.data && userRes.data[0];
    const profile = {
      nickname: user ? user.nickName : '',
      avatar: user ? user.avatarUrl : '',
      initial: user ? user.initial || getInitial(user.nickName) : '我',
      intro: user ? user.intro : '',
      serviceTags: user ? user.serviceTags || [] : []
    };

    // 2. 我创建和协助的卡片
    const cardRes = await db.collection('cards')
      .where({
        $or: [
          { creatorId: openid },
          { helperIds: openid }
        ]
      })
      .orderBy('updatedAt', 'desc')
      .limit(200)
      .get();

    const allCards = (cardRes.data || []).map((card) => ({
      ...card,
      statusText: getStatusText(card.status),
      statusClass: getStatusClass(card.status)
    }));

    const mineCards = allCards.filter((c) => c.creatorId === openid);
    const helpedCards = allCards.filter((c) => Array.isArray(c.helperIds) && c.helperIds.includes(openid));

    // 3. 一度人脉数量
    const relRes = await db.collection('relationships')
      .where({
        ownerId: openid,
        degree: 1
      })
      .count();

    const helperCount = relRes.total || 0;

    // 4. 被求助次数：我创建的卡里，helperIds 非空的数量
    const helpedCount = mineCards.filter((c) => Array.isArray(c.helperIds) && c.helperIds.length > 0).length;

    // 5. 标签候选（简单实现：从标题拆词）
    const candidateTags = analyzeTags(mineCards);

    const data = {
      profile,
      allCards,
      mine: mineCards,
      helped: helpedCards,
      done: mineCards.filter((c) => c.status === 'done'),
      counts: {
        mine: mineCards.filter((c) => c.status !== 'done').length,
        done: mineCards.filter((c) => c.status === 'done').length,
        helped: helpedCards.length
      },
      stats: {
        helperCount,
        helpedCount
      },
      candidateTags
    };

    return { code: 0, message: 'success', data };
  } catch (error) {
    return { code: -2, message: error.message || '查询失败' };
  }
};

function analyzeTags(cards) {
  const keywords = ['设计', '文案', '开发', '运营', '策划', '摄影', '插画', '品牌', '官网', '小程序', '活动', '社群'];
  const titles = cards.map((c) => c.title || '').join(' ');
  const found = keywords.filter((kw) => titles.includes(kw));
  return Array.from(new Set(found));
}
