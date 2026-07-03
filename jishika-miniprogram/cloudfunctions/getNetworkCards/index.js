const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

function getCardDesc(card) {
  if (card.summary) return card.summary;
  if (card.keyPoints && card.keyPoints.length) return card.keyPoints.join(' · ');
  if (card.nextStep) return card.nextStep;
  return '暂无描述';
}

function getCardStatus(card) {
  return card.stage || card.status || '进行中';
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
    // 查询 helperOpenid 创建的、对当前用户可见的卡片
    const cardRes = await db.collection('cards')
      .where({
        creatorId: helperOpenid,
        visibility: _.in(['public', 'friends'])
      })
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();

    // 进一步过滤：friends 范围需要当前用户是创建者或协助者（这里 creatorId 已经是 helperOpenid，所以只要当前用户在 helperIds 中）
    const visibleCards = (cardRes.data || []).filter((card) => {
      if (card.visibility === 'public') return true;
      const helpers = card.helperIds || [];
      return helpers.includes(openid);
    });

    if (!visibleCards.length) {
      return { code: 0, message: 'success', data: [] };
    }

    // 查询 creator 用户信息
    const creatorRes = await db.collection('users')
      .where({ openid: helperOpenid })
      .limit(1)
      .get();

    const creator = (creatorRes.data && creatorRes.data[0]) || {};
    const creatorName = creator.nickName || '朋友';

    const data = visibleCards.map((card) => ({
      id: card.id,
      title: card.projectName || card.typeLabel || '未命名事项',
      desc: getCardDesc(card),
      creatorName,
      relation: `${creatorName}的朋友`,
      status: getCardStatus(card),
      visibility: card.visibility
    }));

    return { code: 0, message: 'success', data };
  } catch (error) {
    return { code: -3, message: error.message || '查询失败', data: [] };
  }
};
