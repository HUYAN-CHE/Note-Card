const TYPE_LABELS = {
  requirement: '需求确认卡',
  progress: '服务进度卡',
  todo: '群聊待办',
  meeting: '预约记录'
};

const { inferSkillName } = require('./skill-registry');

function safeDecode(value = '') {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return value;
  }
}

function normalizeLaunchContext(options = {}) {
  const query = options.query || {};
  const source = query.source || query.from || '';
  const rawText = safeDecode(query.context || query.text || query.q || '');
  const explicitIntent = query.intent || query.type || '';
  const cardType = inferCardType(rawText, explicitIntent);
  const skillName = query.skill || inferSkillName(rawText, explicitIntent);
  const isWechatAI = source === 'wechat_ai' || source === 'wx_ai' || String(explicitIntent).indexOf('ai_') === 0;

  return {
    source: isWechatAI ? 'wechat_ai' : source,
    intent: explicitIntent,
    skillName,
    rawText,
    cardType,
    hasContext: Boolean(rawText || isWechatAI || explicitIntent)
  };
}

function inferCardType(text = '', explicitType = '') {
  if (TYPE_LABELS[explicitType]) return explicitType;

  const value = `${explicitType} ${text}`;
  if (/会议|沟通|约|时间|腾讯会议|开会/.test(value)) return 'meeting';
  if (/待办|负责|截止|群里|群聊|安排|谁来/.test(value)) return 'todo';
  if (/进度|节点|完成|资料|阶段|交付/.test(value)) return 'progress';

  return 'requirement';
}

function buildDraftFromContext(params = {}) {
  const text = (params.text || '').trim();
  const type = params.type || inferCardType(text);
  const title = extractTitle(text, type);
  const desc = extractDesc(text, title);
  const keyPoints = extractKeyPoints(text, type);

  return {
    type,
    typeLabel: TYPE_LABELS[type] || TYPE_LABELS.requirement,
    source: params.source || 'manual',
    rawContext: text,
    files: params.files || [],
    title,
    desc,
    keyPoints,
    status: 'draft',
    isNetworkVisible: true,
    createdAt: Date.now()
  };
}

function extractTitle(text, type) {
  if (!text) return '';

  const titleMatch = text.match(/(?:标题|事项|项目|需求)[:：]\s*([^\n，。；;]{2,30})/);
  if (titleMatch) return titleMatch[1].trim();

  const firstLine = text.split(/\n/).map((line) => line.trim()).find(Boolean) || text;
  if (firstLine.length <= 20) return firstLine;

  return `${firstLine.slice(0, 18)}…`;
}

function extractDesc(text, title) {
  if (!text) return '';

  const firstLine = text.split(/\n/).map((line) => line.trim()).find(Boolean) || text;
  if (firstLine.length <= 20) {
    const rest = text.replace(firstLine, '').trim();
    return rest || firstLine;
  }

  return text;
}

function extractKeyPoints(text, type) {
  const fallback = {
    requirement: ['明确需求范围', '确认期望时间', '补充必要资料'],
    progress: ['确认当前节点', '明确下一步动作', '设置跟进提醒'],
    todo: ['整理群聊待办', '明确负责人', '确认截止时间'],
    meeting: ['确认沟通主题', '选择可约时间', '记录会议结论']
  };

  if (!text) return [];

  const lines = text
    .split(/[\n。；;，,]/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4 && line.length <= 36 && line !== extractTitle(text, type));

  const unique = Array.from(new Set(lines)).slice(0, 5);
  return unique.length ? unique : fallback[type] || fallback.requirement;
}

module.exports = {
  TYPE_LABELS,
  normalizeLaunchContext,
  inferCardType,
  buildDraftFromContext
};
