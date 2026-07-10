const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

const DEFAULT_TAGS = [
  '官网设计', '品牌梳理', '文案写作', '插画设计', '摄影摄像',
  '小程序开发', '活动策划', '社群运营', '法律咨询', '财务规划',
  '心理咨询', '健身指导', '留学移民', '房产顾问', '家庭教育'
];

const KEYWORD_TAGS = [
  { keywords: ['官网', '网站', '网页'], tag: '官网设计' },
  { keywords: ['品牌', 'VI', 'Logo', 'logo'], tag: '品牌梳理' },
  { keywords: ['文案', '内容', '公众号'], tag: '文案写作' },
  { keywords: ['插画', '绘本', '儿童'], tag: '插画设计' },
  { keywords: ['摄影', '拍照', '白底图'], tag: '摄影摄像' },
  { keywords: ['小程序', '开发', '前端'], tag: '小程序开发' },
  { keywords: ['活动', '沙龙', '策划'], tag: '活动策划' },
  { keywords: ['社群', '私域', '运营'], tag: '社群运营' },
  { keywords: ['法律', '合同', '协议'], tag: '法律咨询' },
  { keywords: ['财务', '税务', '记账'], tag: '财务规划' }
];

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (!openid) {
    return { code: -1, message: '未获取到用户身份', data: DEFAULT_TAGS };
  }

  try {
    const cardRes = await db.collection('cards')
      .where({ creatorId: openid })
      .limit(100)
      .get();

    const cards = cardRes.data || [];
    const text = cards.map((c) => `${c.title || ''} ${c.desc || ''}`).join(' ');

    const matched = new Set();
    KEYWORD_TAGS.forEach(({ keywords, tag }) => {
      if (keywords.some((kw) => text.includes(kw))) {
        matched.add(tag);
      }
    });

    const result = Array.from(matched);
    if (!result.length) {
      return { code: 0, message: 'success', data: DEFAULT_TAGS.slice(0, 6) };
    }

    return { code: 0, message: 'success', data: result };
  } catch (error) {
    return { code: 0, message: 'success', data: DEFAULT_TAGS.slice(0, 6) };
  }
};
