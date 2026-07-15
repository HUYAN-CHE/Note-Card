const cloud = require('wx-server-sdk');
const tcb = require('@cloudbase/node-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const app = tcb.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const TYPE_LABELS = {
  requirement: '需求确认卡',
  progress: '服务进度卡',
  todo: '群聊待办',
  meeting: '预约记录'
};

const SYSTEM_PROMPT = `你是一个智能「记事卡」解析助手。请从用户输入的文本中提取三个字段，只返回 JSON，不要任何额外文字或 markdown 代码块标记。

JSON 格式：
{
  "title": "简短标题（5-15 字概括核心内容）",
  "desc": "需求描述（把原文整理成通顺的自然语言描述，保留关键细节，100-300字）",
  "keyPoints": [
    "重点/待确认事项 1",
    "重点/待确认事项 2",
    "重点/待确认事项 3"
  ]
}

要求：
- title 必须简洁有力，像记事卡的标题
- desc 保留原文所有关键信息，整理成通顺段落
- keyPoints 提取需要重点关注或待确认的事项，每项一句话，至少 1 条最多 5 条
- 如果是闲聊或无实质内容，请合理提取或写明"未识别到有效信息"`;

exports.main = async (event, context) => {
  console.log('[parseContext] 收到请求', JSON.stringify({ action: event.action }));

  try {
    if (event.action === 'parseText') {
      return await handleParseText(event.text, event.type);
    }
    if (event.action === 'parseImage') {
      return await handleParseImage(event.fileID, event.type);
    }
    return { code: -1, message: '未知 action，请传 parseText 或 parseImage' };
  } catch (err) {
    console.error('[parseContext] 错误', err);
    return { code: -1, message: err.message || err };
  }
};

async function handleParseText(text, type) {
  if (!text || text.trim().length === 0) {
    return { code: -1, message: '文本内容为空' };
  }

  const result = await callTextModel(text, type);
  return extractJSON(result);
}

async function callTextModel(text, type) {
  const ai = app.ai();
  const model = ai.createModel('hy3');

  const typeLabel = TYPE_LABELS[type] || '记事卡';
  const userContent = `请解析以下文本，整理成一张"${typeLabel}"。\n\n${text}`;

  const res = await model.generateText({
    model: 'hy3',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent }
    ]
  });

  console.log('[callTextModel] AI 原始返回:', res.text);
  return res.text;
}

async function handleParseImage(fileID, type) {
  if (!fileID) {
    return { code: -1, message: '图片 fileID 为空' };
  }

  const tmpRes = await cloud.getTempFileURL({
    fileList: [{ fileID, maxAge: 3600 }]
  });

  const fileObj = tmpRes.fileList[0];
  if (!fileObj || fileObj.code !== 'SUCCESS' || !fileObj.tempFileURL) {
    return { code: -1, message: '获取图片临时 URL 失败' };
  }

  const imageUrl = fileObj.tempFileURL;
  console.log('[handleParseImage] 图片临时 URL:', imageUrl);

  try {
    const result = await callVisionModel(imageUrl, type);
    return extractJSON(result);
  } catch (visionErr) {
    console.warn('[handleParseImage] 多模态失败，降级 OCR:', visionErr.message);
    return await fallbackOCR(imageUrl, type);
  }
}

async function callVisionModel(imageUrl, type) {
  const ai = app.ai();
  const visionModel = ai.createModel('hy3');

  const typeLabel = TYPE_LABELS[type] || '记事卡';
  const visionPrompt = `你是一个智能「记事卡」解析助手。请识别图片中的文字内容，整理成一张"${typeLabel}"，只返回 JSON 格式，不要任何额外文字。

JSON 格式：
{
  "title": "简短标题（5-15 字概括核心内容）",
  "desc": "需求描述（整理成通顺段落，保留关键细节）",
  "keyPoints": ["重点/待确认事项 1", "重点/待确认事项 2"]
}

注意：图片通常是微信聊天截图，请识别其中的文字内容，title 简洁概括对话主题，desc 整理对话中的需求或任务，keyPoints 提取需要重点关注或待确认的事项。`;

  const res = await visionModel.generateText({
    model: 'hy3-preview',
    messages: [
      { role: 'system', content: visionPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请识别这张图片中的文字内容并提取信息' },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }
    ]
  });

  console.log('[callVisionModel] AI 原始返回:', res.text);
  return res.text;
}

async function fallbackOCR(imageUrl, type) {
  try {
    const imgResp = await fetch(imageUrl);
    const imgBuffer = await imgResp.arrayBuffer();
    const base64Image = Buffer.from(imgBuffer).toString('base64');

    const ocrText = await callCloudOCR(base64Image);
    if (!ocrText) {
      return { code: -1, message: 'OCR 识别失败，请确认图片中有清晰文字' };
    }

    console.log('[fallbackOCR] OCR 文字:', ocrText);
    return await handleParseText(ocrText, type);
  } catch (err) {
    console.error('[fallbackOCR] 失败:', err.message);
    return { code: -1, message: '图片识别失败: ' + err.message };
  }
}

async function callCloudOCR(base64Image) {
  try {
    const ocrResult = await app.callCloudApi({
      service: 'ocr',
      action: 'GeneralBasicOCR',
      params: { ImageBase64: base64Image }
    });

    return (ocrResult.TextDetections || [])
      .map((item) => item.DetectedText)
      .join('\n');
  } catch (err) {
    console.error('[callCloudOCR] 失败:', err.message);
    return '';
  }
}

function extractJSON(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    return validateResult(parsed);
  } catch (e) {
    const cleaned = rawText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*$/gm, '')
      .trim();

    try {
      const parsed = JSON.parse(cleaned);
      return validateResult(parsed);
    } catch (e2) {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return validateResult(parsed);
      }
      throw new Error('AI 返回无法解析为 JSON: ' + rawText.substring(0, 200));
    }
  }
}

function validateResult(data) {
  return {
    code: 0,
    data: {
      title: data.title || '未命名记事卡',
      desc: data.desc || data.description || '',
      keyPoints: Array.isArray(data.keyPoints) ? data.keyPoints : []
    }
  };
}
