/**
 * 主题图标匹配：按卡片 keyPoints / title 关键词匹配系统 emoji 字符。
 * 零素材零配置；永远有返回值（default 兜底）。
 */

// 主题 → emoji 字符
const THEME_ICONS = {
  camp: '⛺',
  meeting: '🤝',
  design: '🎨',
  travel: '✈️',
  food: '🍜',
  move: '📦',
  study: '📚',
  sport: '👟',
  shopping: '🛒',
  gift: '🎁',
  work: '💼',
  health: '💊',
  default: '📝'
};

// 主题 → 关键词（命中其一即使用该主题图）
const THEME_KEYWORDS = {
  camp: ['露营', '户外', '野营', '帐篷', '徒步', '爬山'],
  meeting: ['会议', '开会', '沟通', '进度会', '评审', '对齐'],
  design: ['装修', '设计', '改版', '视觉', '首页', '海报'],
  travel: ['旅行', '出行', '机票', '酒店', '旅游', '行程'],
  food: ['聚餐', '吃饭', '团建', '餐厅', '火锅', '美食'],
  move: ['搬家', '整理', '收纳', '搬运', '打包'],
  study: ['学习', '考试', '阅读', '课程', '培训', '背单词'],
  sport: ['运动', '健身', '跑步', '瑜伽', '游泳', '球'],
  shopping: ['购物', '采购', '清单', '下单', '快递'],
  gift: ['生日', '礼物', '纪念日', '惊喜', '祝福'],
  work: ['项目', '交付', '工作', '需求', '上线', '客户'],
  health: ['医疗', '体检', '健康', '复诊', '药', '医院']
};

/**
 * 按卡片内容匹配主题 emoji 字符。
 * @param {Object} card 卡片（keyPoints 数组 + title 字符串）
 * @returns {string} emoji 字符，未命中返回默认 📝
 */
function resolveThemeIcon(card = {}) {
  const keyPoints = Array.isArray(card.keyPoints) ? card.keyPoints : [];
  const text = [...keyPoints, card.title || ''].filter(Boolean).join(' ');

  let theme = '';
  if (text) {
    for (const key of Object.keys(THEME_KEYWORDS)) {
      if (THEME_KEYWORDS[key].some((word) => text.indexOf(word) !== -1)) {
        theme = key;
        break;
      }
    }
  }

  return THEME_ICONS[theme] || THEME_ICONS.default || '';
}

module.exports = { THEME_ICONS, THEME_KEYWORDS, resolveThemeIcon };
