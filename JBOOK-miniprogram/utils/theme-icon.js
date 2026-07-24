/**
 * 主题图标匹配：按卡片 keyPoints / title 关键词匹配系统 emoji 字符。
 * 零素材零配置；永远有返回值（default 兜底）。
 */

// 主题 → emoji 字符（顺序即匹配优先级，具体场景在前、宽泛场景在后）
const THEME_ICONS = {
  camp: '⛺',
  wedding: '💒',
  baby: '👶',
  school: '🏫',
  pet: '🐱',
  car: '🚗',
  travel: '✈️',
  express: '📦',
  move: '🚚',
  house: '🏠',
  repair: '🔧',
  plant: '🌱',
  food: '🍜',
  cook: '🍳',
  entertainment: '🎤',
  movie: '🎬',
  game: '🎮',
  sport: '👟',
  beauty: '💇',
  shopping: '🛒',
  gift: '🎁',
  photo: '📷',
  study: '📚',
  job: '👔',
  meeting: '🤝',
  design: '🎨',
  work: '💼',
  money: '💰',
  finance: '📈',
  insurance: '🛡️',
  legal: '⚖️',
  document: '🛂',
  volunteer: '🙋',
  health: '💊',
  default: '📝'
};

// 主题 → 关键词（命中其一即使用该主题 emoji）
const THEME_KEYWORDS = {
  camp: ['露营', '户外', '野营', '帐篷', '徒步', '爬山'],
  wedding: ['婚礼', '结婚', '婚纱', '婚宴', '司仪', '伴郎', '伴娘'],
  baby: ['宝宝', '孩子', '育儿', '奶粉', '幼儿园', '尿布', '遛娃'],
  school: ['学校', '家长会', '作业', '开学', '老师', '班级', '放学'],
  pet: ['宠物', '猫', '狗', '遛狗', '猫粮', '狗粮', '疫苗'],
  car: ['车辆', '接送', '开车', '停车', '加油', '洗车', '保养', '打车', '拼车'],
  travel: ['旅行', '出行', '机票', '酒店', '旅游', '行程', '高铁', '车票', '抢票'],
  express: ['快递', '物流', '发货', '收货', '寄件', '驿站', '签收'],
  move: ['搬家', '整理', '收纳', '搬运', '打包', '货拉拉'],
  house: ['租房', '看房', '房东', '物业', '水电', '房租', '续租'],
  repair: ['维修', '修理', '家电', '安装', '师傅', '家政', '保洁', '疏通'],
  plant: ['植物', '养花', '绿植', '园艺', '浇水', '盆栽'],
  food: ['聚餐', '吃饭', '团建', '餐厅', '火锅', '美食', '外卖', '奶茶'],
  cook: ['做饭', '菜谱', '烘焙', '下厨', '买菜', '备菜'],
  entertainment: ['K歌', '唱歌', '酒吧', '夜场', 'KTV', '桌游'],
  movie: ['电影', '演出', '演唱会', '话剧', '音乐剧', '门票'],
  game: ['游戏', '开黑', '电竞', '剧本杀', '密室', 'Switch', '王者'],
  sport: ['运动', '健身', '跑步', '瑜伽', '游泳', '篮球', '足球', '打球'],
  beauty: ['理发', '美容', '美甲', '护肤', '造型', '烫染', '剪发'],
  shopping: ['购物', '采购', '清单', '下单', '囤货', '团购'],
  gift: ['生日', '礼物', '纪念日', '惊喜', '祝福', '情人节'],
  photo: ['拍照', '摄影', '写真', '证件照', '拍摄', '约拍'],
  study: ['学习', '考试', '阅读', '课程', '培训', '背单词', '备考'],
  job: ['招聘', '面试', '求职', '简历', '入职', '离职', '跳槽'],
  meeting: ['会议', '开会', '沟通', '进度会', '评审', '对齐', '周会'],
  design: ['装修', '设计', '改版', '视觉', '首页', '海报', '出图'],
  work: ['项目', '交付', '工作', '需求', '上线', '客户', '加班'],
  money: ['费用', '报销', '转账', '付款', '预算', '账单', 'AA', '借钱'],
  finance: ['理财', '股票', '基金', '银行', '贷款', '利率', '存款'],
  insurance: ['保险', '理赔', '保单', '续保'],
  legal: ['法律', '合同', '律师', '纠纷', '仲裁', '起诉'],
  document: ['签证', '护照', '证件', '身份证', '办理', '港澳', '居住证'],
  volunteer: ['志愿', '义工', '公益', '社区服务', '捐赠'],
  health: ['医疗', '体检', '健康', '复诊', '药', '医院', '挂号']
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
