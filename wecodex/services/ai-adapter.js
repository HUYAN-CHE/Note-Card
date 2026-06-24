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
  const isWechatAI = source === 'wechat_ai' || source === 'wx_ai' || explicitIntent.indexOf('ai_') === 0;

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
  const phone = extractPhone(text);
  const customerName = extractName(text);
  const projectName = extractProject(text, type);
  const keyPoints = extractKeyPoints(text, type);
  const questions = extractQuestions(text, type);

  return {
    type,
    typeLabel: TYPE_LABELS[type] || TYPE_LABELS.requirement,
    source: params.source || 'manual',
    rawContext: text,
    files: params.files || [],
    customerName,
    phone,
    projectName,
    summary: buildSummary(text, type, projectName),
    keyPoints,
    questions,
    nextStep: buildNextStep(type),
    reminderText: '',
    createdAt: Date.now()
  };
}

function extractPhone(text) {
  const match = text.match(/1[3-9]\d{9}/);
  return match ? match[0] : '';
}

function extractName(text) {
  const labelMatch = text.match(/(?:客户|联系人|姓名|称呼)[:：]\s*([\u4e00-\u9fa5A-Za-z0-9_-]{1,12})/);
  if (labelMatch) return labelMatch[1];

  const nameMatch = text.match(/([\u4e00-\u9fa5]{1,4})(?:总|姐|哥|老师|女士|先生)/);
  return nameMatch ? nameMatch[0] : '';
}

function extractProject(text, type) {
  if (!text) {
    return type === 'todo' ? '群聊事项' : '客户服务事项';
  }

  const projectMatch = text.match(/(?:项目|需求|事项)[:：]\s*([^\n，。；;]{2,24})/);
  if (projectMatch) return projectMatch[1].trim();

  if (/官网/.test(text)) return '官网改版';
  if (/品牌/.test(text)) return '品牌服务';
  if (/活动|物料|海报/.test(text)) return '活动物料';
  if (/会员|私域|社群/.test(text)) return '私域运营';

  return type === 'meeting' ? '沟通预约' : '客户需求';
}

function extractKeyPoints(text, type) {
  const fallback = {
    requirement: ['明确服务范围', '确认期望时间', '补充必要资料'],
    progress: ['确认当前节点', '明确下一步动作', '设置跟进提醒'],
    todo: ['整理群聊待办', '明确负责人', '确认截止时间'],
    meeting: ['确认沟通主题', '选择可约时间', '记录会议链接']
  };

  if (!text) return fallback[type] || fallback.requirement;

  const lines = text
    .split(/[\n。；;，,]/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4 && line.length <= 36);

  return unique(lines).slice(0, 5).length ? unique(lines).slice(0, 5) : fallback[type] || fallback.requirement;
}

function extractQuestions(text, type) {
  const questions = [];

  if (!/时间|上线|截止|什么时候/.test(text)) questions.push('期望完成时间是什么？');
  if (type === 'requirement' && !/资料|文案|参考|素材/.test(text)) questions.push('是否有参考资料或已有素材？');
  if (type === 'meeting' && !/几点|上午|下午|晚上|\d{1,2}[:：点]/.test(text)) questions.push('方便沟通的具体时间是？');
  if (type === 'todo' && !/负责|谁|owner|负责人/.test(text)) questions.push('每个待办分别由谁负责？');

  return questions.slice(0, 3);
}

function buildSummary(text, type, projectName) {
  if (!text) {
    return `围绕「${projectName}」创建${TYPE_LABELS[type] || '记事卡'}，等待补充上下文。`;
  }

  const firstLine = text.split(/\n/).map((line) => line.trim()).find(Boolean) || text;
  if (firstLine.length <= 42) return firstLine;

  return `${firstLine.slice(0, 42)}...`;
}

function buildNextStep(type) {
  const map = {
    requirement: '发给客户确认需求',
    progress: '更新当前节点并设置提醒',
    todo: '绑定客户或项目并设置截止时间',
    meeting: '确认时间并发送会议安排'
  };

  return map[type] || map.requirement;
}

function unique(list) {
  return Array.from(new Set(list));
}

module.exports = {
  TYPE_LABELS,
  normalizeLaunchContext,
  inferCardType,
  buildDraftFromContext
};
