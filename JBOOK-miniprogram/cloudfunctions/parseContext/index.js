const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const TYPE_LABELS = {
  requirement: '需求确认卡',
  progress: '服务进度卡',
  todo: '群聊待办',
  meeting: '预约记录'
};

function inferCardType(text = '', explicitType = '') {
  if (TYPE_LABELS[explicitType]) return explicitType;

  const value = `${explicitType} ${text}`;
  if (/会议|沟通|约|时间|腾讯会议|开会/.test(value)) return 'meeting';
  if (/待办|负责|截止|群里|群聊|安排|谁来/.test(value)) return 'todo';
  if (/进度|节点|完成|资料|阶段|交付/.test(value)) return 'progress';

  return 'requirement';
}

function extractTitle(text, type) {
  if (!text) return TYPE_LABELS[type] || '未命名事项';

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

  if (!text) return fallback[type] || fallback.requirement;

  const lines = text
    .split(/[\n。；;，,]/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4 && line.length <= 36 && line !== extractTitle(text, type));

  const unique = Array.from(new Set(lines)).slice(0, 5);
  return unique.length ? unique : fallback[type] || fallback.requirement;
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

// 预留：调用真实 LLM 解析
async function callLLM(text, imageTexts, type) {
  // TODO: 接入腾讯云/豆包/通义等 LLM API
  // 返回结构：{ title, desc, keyPoints, type, helperIds? }
  return null;
}

// 预留：OCR 识别图片
async function ocrImages(fileIDs) {
  if (!fileIDs || !fileIDs.length) return '';
  // TODO: 接入腾讯云 OCR 或微信智能接口
  // 返回合并后的文字
  return '';
}

exports.main = async (event, context) => {
  const { text = '', imageFileIDs = [], type = '', explicitType = '' } = event;

  try {
    // 1. 如果有图片，先 OCR 提取文字（预留）
    const imageText = await ocrImages(imageFileIDs);

    // 2. 合并所有文本
    const combinedText = [text, imageText].filter(Boolean).join('\n').trim();

    if (!combinedText) {
      return { code: -1, message: '没有可识别的内容' };
    }

    // 3. 优先调用真实 AI（预留）
    const aiResult = await callLLM(combinedText, imageText, explicitType || type);
    if (aiResult && aiResult.title) {
      return {
        code: 0,
        data: {
          ...buildDraftFromContext({ text: combinedText, type: aiResult.type || explicitType || type, source: imageFileIDs.length ? 'image_ai' : 'clipboard_ai' }),
          ...aiResult
        }
      };
    }

    // 4. 兜底：本地规则
    const draft = buildDraftFromContext({
      text: combinedText,
      type: explicitType || type || undefined,
      source: imageFileIDs.length ? 'image_ai' : 'clipboard_ai'
    });

    return { code: 0, data: draft };
  } catch (error) {
    return { code: -2, message: error.message || '识别失败' };
  }
};
