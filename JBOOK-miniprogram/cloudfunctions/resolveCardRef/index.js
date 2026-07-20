const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// Agent 短码解析：按权限输出结构化卡片内容
// 不返回 openid、helperIds、联系方式、pendingRequests 等敏感字段，不涉及原始聊天记录
exports.main = async (event, context) => {
  const { code } = event;
  if (!code || typeof code !== 'string') {
    return { code: -2, message: '缺少卡片短码' };
  }

  try {
    const cardRes = await db.collection('cards')
      .where({ refCode: code.trim().toUpperCase() })
      .limit(1)
      .get();

    const card = cardRes.data && cardRes.data[0];
    if (!card) {
      return { code: -3, message: '短码不存在或已失效' };
    }

    // 查询创立者昵称
    const creatorRes = await db.collection('users')
      .where({ _openid: card.creatorId })
      .limit(1)
      .get();
    const creatorUser = creatorRes.data && creatorRes.data[0];

    const helpersCount = Array.isArray(card.helperIds) ? card.helperIds.filter(Boolean).length : 0;

    // 二度人脉可见 → network 视图（结构化全字段）；否则 public 视图（仅标题/状态/更新时间）
    if (card.isNetworkVisible !== false) {
      return {
        code: 0,
        schema: 'jishika/card@1',
        view: 'network',
        card: {
          refCode: card.refCode,
          title: card.title || '',
          status: card.status || 'draft',
          deadline: card.deadline || '',
          updatedText: card.updatedText || '',
          desc: card.desc || '',
          keyPoints: Array.isArray(card.keyPoints) ? card.keyPoints : [],
          creatorNickname: creatorUser ? creatorUser.nickName : '未知用户',
          helpersCount
        }
      };
    }

    return {
      code: 0,
      schema: 'jishika/card@1',
      view: 'public',
      card: {
        refCode: card.refCode,
        title: card.title || '',
        status: card.status || 'draft',
        updatedText: card.updatedText || ''
      }
    };
  } catch (error) {
    return { code: -5, message: error.message || '解析失败' };
  }
};
