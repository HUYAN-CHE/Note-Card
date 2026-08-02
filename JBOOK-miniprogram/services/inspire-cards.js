// 灵感卡数据访问层：封装 inspireCard 云函数，带内存缓存
// 首页「灵感」tab、我的主页「我的灵感卡」、灵感卡列表页共用
// 展示层字段映射：{ id, title, desc: subtitle, tags: keywords, color, status, sparkCount, updatedAt }

// ============ 样式预览开关 ============
// true：全部走本地假数据（云函数未部署前预览样式/交互）；云函数部署后改 false
const USE_MOCK = true;

const MOCK_CARDS = [
  {
    id: 'mock-1',
    title: '社区团购新玩法',
    subtitle: '从邻居拼单到熟人小站的方向探索',
    keywords: ['社区团购', '熟人信任', '自提点'],
    status: 'collecting',
    sparks: [
      { text: '楼下水果店老板娘拉了个群，每天发今日特价，群里接龙就能拼单，比平台便宜不少', createdAt: '2026-07-28T09:12:00.000Z' },
      { text: '拼单的核心不是便宜，是熟人背书——老板娘说好吃大家就敢买', createdAt: '2026-07-29T14:03:00.000Z' },
      { text: '如果做一个「小站站长」工具，帮这类人管订单、收款、通知自提，可能有戏', createdAt: '2026-07-30T20:45:00.000Z' }
    ],
    article: '',
    color: '#cfe8fb',
    createdAt: '2026-07-28T09:12:00.000Z',
    updatedAt: '2026-07-30T20:45:00.000Z'
  },
  {
    id: 'mock-2',
    title: '亲子周末活动库',
    subtitle: '解决家长「周末带娃去哪」的决策难题',
    keywords: ['亲子', '周末', '活动推荐'],
    status: 'collecting',
    sparks: [
      { text: '每个周五晚上家长群都在问同一个问题：明天带娃去哪？', createdAt: '2026-07-25T21:30:00.000Z' },
      { text: '可以按年龄段 + 天气 + 距离三个维度推荐，室内馆/户外公园/博物馆', createdAt: '2026-07-26T10:05:00.000Z' }
    ],
    article: '',
    color: '#f6dfb8',
    createdAt: '2026-07-25T21:30:00.000Z',
    updatedAt: '2026-07-26T10:05:00.000Z'
  },
  {
    id: 'mock-3',
    title: '职场技能短视频栏目',
    subtitle: '一分钟讲透一个办公小技巧的内容企划',
    keywords: ['短视频', '职场', '知识付费', '内容栏目'],
    status: 'exported',
    sparks: [
      { text: 'Excel 的 VLOOKUP 十个人九个不会，但学会只要一分钟', createdAt: '2026-07-20T08:20:00.000Z' },
      { text: '栏目名可以叫「下班前一分钟」，固定片头片尾形成记忆点', createdAt: '2026-07-21T12:40:00.000Z' },
      { text: '先做 Excel 系列十期试水，数据好再扩 PPT 和 Word', createdAt: '2026-07-22T19:15:00.000Z' }
    ],
    article: '职场里最浪费时间的，往往不是工作本身，而是那些「十分钟能学会、却没人教过」的小技巧。\n\nExcel 的 VLOOKUP 就是典型——十个人里九个不会，但真正学会只要一分钟。这类内容有天然的传播力：痛点明确、见效即时、收藏率高。\n\n栏目定名「下班前一分钟」，固定片头片尾形成记忆点。第一期从 Excel 系列切入，连做十期试水：函数、透视表、快捷键、图表美化。数据跑通后，再扩展到 PPT 和 Word 两个系列。\n\n内容结构保持极简：一个痛点场景开场，三十秒演示操作，最后十秒总结口诀。不追求全面，只追求「看完就能用」。',
    color: '#fbd8cf',
    createdAt: '2026-07-20T08:20:00.000Z',
    updatedAt: '2026-07-24T16:00:00.000Z'
  },
  {
    id: 'mock-4',
    title: '办公室咖啡角计划',
    subtitle: '用一杯咖啡重建同事间的闲聊时刻',
    keywords: ['办公室', '咖啡', '同事关系'],
    status: 'exported',
    sparks: [
      { text: '自从大家都点外卖咖啡，茶水间排队闲聊的场景消失了', createdAt: '2026-07-15T11:00:00.000Z' },
      { text: '众筹一台意式机放公共区域，豆子大家轮流带，仪式感拉满', createdAt: '2026-07-16T15:30:00.000Z' }
    ],
    article: '外卖咖啡很方便，但它悄悄拿走了办公室里一样东西：茶水间排队时的闲聊。\n\n计划很简单：众筹一台意式咖啡机放在公共区域，豆子大家轮流带。做咖啡要等三五分钟，这段时间天然适合聊两句——项目进展、周末去哪、新上的电影。\n\n成本不高，仪式感很足。一杯咖啡换回来的，是同事之间越来越稀薄的非正式连接。',
    color: '#f2d3e6',
    createdAt: '2026-07-15T11:00:00.000Z',
    updatedAt: '2026-07-18T09:20:00.000Z'
  }
];

let cachedCards = null;

function toViewModel(card) {
  return {
    id: card.id,
    title: card.title || '未命名灵感',
    desc: card.subtitle || '',
    tags: Array.isArray(card.keywords) ? card.keywords : [],
    color: card.color || '#cfe8fb',
    status: card.status === 'exported' ? 'exported' : 'collecting',
    sparkCount: Array.isArray(card.sparks) ? card.sparks.length : 0,
    updatedAt: card.updatedAt || ''
  };
}

function callInspireCard(data) {
  return wx.cloud.callFunction({ name: 'inspireCard', data }).then((res) => {
    const result = (res && res.result) || {};
    if (result.code !== 0) {
      throw new Error(result.message || '灵感卡服务异常');
    }
    return result.data || {};
  });
}

function findMock(id) {
  const card = MOCK_CARDS.find((c) => c.id === id);
  if (!card) throw new Error('灵感卡不存在');
  return card;
}

// 瀑布流分列：按序号奇偶交错到左右两列。
// 卡片颜色在创建时按 4 色板循环写死、列表按创建时间排序，序号相邻必不同色；
// 奇偶分列下同列序号差恒为 2、左右同排差 1，4 色循环下上下/左右相邻都不会撞色
function splitInspireColumns(cards) {
  const left = [];
  const right = [];
  (cards || []).forEach((card, index) => {
    if (index % 2 === 0) {
      left.push(card);
    } else {
      right.push(card);
    }
  });
  return { left, right };
}

// 灵感卡列表（默认走缓存，forceRefresh 强制刷新）
function listInspireCards(forceRefresh) {
  if (USE_MOCK) {
    cachedCards = MOCK_CARDS.map(toViewModel);
    return Promise.resolve(cachedCards);
  }
  if (cachedCards && !forceRefresh) {
    return Promise.resolve(cachedCards);
  }
  return callInspireCard({ action: 'list' }).then((data) => {
    cachedCards = (data.cards || []).map(toViewModel);
    return cachedCards;
  });
}

// 单卡详情（含 sparks、article 正文）
function getInspireCard(id) {
  if (USE_MOCK) {
    return Promise.resolve(findMock(id));
  }
  return callInspireCard({ action: 'detail', id }).then((data) => data.card);
}

// 保存文章页编辑（标题/副标题/关键词/文章/状态），成功后刷新缓存
function updateInspireCard(id, fields) {
  if (USE_MOCK) {
    const card = findMock(id);
    if (typeof fields.title === 'string') card.title = fields.title.trim();
    if (typeof fields.subtitle === 'string') card.subtitle = fields.subtitle.trim();
    if (Array.isArray(fields.keywords)) card.keywords = fields.keywords.filter(Boolean).slice(0, 7);
    if (typeof fields.article === 'string') card.article = fields.article;
    if (fields.status === 'collecting' || fields.status === 'exported') card.status = fields.status;
    card.updatedAt = new Date().toISOString();
    cachedCards = null;
    return Promise.resolve(card);
  }
  return callInspireCard({ action: 'update', id, ...fields }).then((data) => {
    cachedCards = null;
    return data.card;
  });
}

// AI 整理：重新提取 标题/副标题/关键词/文章
function summarizeInspireCard(id) {
  if (USE_MOCK) {
    // mock：模拟 AI 耗时后，把灵感条目拼成一篇文章，标题/关键词保持不变
    const card = findMock(id);
    return new Promise((resolve) => {
      setTimeout(() => {
        const paragraphs = card.sparks.map((s) => s.text).join('\n\n');
        card.article = `${paragraphs}\n\n（以上为模拟 AI 整理效果，部署云函数后由混元大模型真实生成。）`;
        card.updatedAt = new Date().toISOString();
        cachedCards = null;
        resolve(card);
      }, 1200);
    });
  }
  return callInspireCard({ action: 'summarize', id }).then((data) => {
    cachedCards = null;
    return data.card;
  });
}

// 追加一条零碎灵感（Bot 联调/测试入口）
function addSpark(id, text) {
  if (USE_MOCK) {
    const card = findMock(id);
    card.sparks.push({ text, createdAt: new Date().toISOString() });
    card.updatedAt = new Date().toISOString();
    cachedCards = null;
    return Promise.resolve(card);
  }
  return callInspireCard({ action: 'addSpark', id, text }).then((data) => {
    cachedCards = null;
    return data.card;
  });
}

// 新建灵感卡（可带首条灵感，Bot 联调/测试入口）
function createInspireCard(text) {
  if (USE_MOCK) {
    return Promise.reject(new Error('预览模式暂不支持新建'));
  }
  return callInspireCard({ action: 'create', text }).then((data) => {
    cachedCards = null;
    return data.card;
  });
}

module.exports = {
  listInspireCards,
  getInspireCard,
  updateInspireCard,
  summarizeInspireCard,
  addSpark,
  createInspireCard,
  splitInspireColumns
};
