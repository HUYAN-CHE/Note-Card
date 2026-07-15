const cloud = require('wx-server-sdk');
const tcb = require('@cloudbase/node-sdk');
const tencentcloud = require('tencentcloud-sdk-nodejs-asr');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const app = tcb.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const AsrClient = tencentcloud.asr.v20190614.Client;

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

function createAsrClient() {
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error('腾讯云 ASR 密钥未配置');
  }
  return new AsrClient({
    credential: { secretId, secretKey },
    region: 'ap-beijing',
    profile: { httpProfile: { endpoint: 'asr.ap-beijing.tencentcloudapi.com' } }
  });
}

exports.main = async (event, context) => {
  console.log('[parseContext] 收到请求', JSON.stringify({ action: event.action }));

  try {
    if (event.action === 'parseText') {
      return await handleParseText(event.text, event.type);
    }
    if (event.action === 'parseVoice') {
      return await handleParseVoice(event.fileID, event.type);
    }
    if (event.action === 'parseVoiceBase64') {
      return await handleParseVoiceBase64(event.base64Audio, event.format, event.type);
    }
    return { code: -1, message: '未知 action，当前仅支持 parseText / parseVoice / parseVoiceBase64' };
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

async function handleParseVoiceBase64(base64Audio, format, type) {
  if (!base64Audio) {
    return { code: -1, message: '音频数据为空' };
  }

  try {
    const inputBuffer = Buffer.from(base64Audio, 'base64');
    console.log('[handleParseVoiceBase64] input audio length:', inputBuffer.length, 'format:', format);

    if (inputBuffer.length <= 0) {
      return { code: -1, message: '音频数据为空' };
    }

    if (inputBuffer.length > 3 * 1024 * 1024) {
      return { code: -1, message: '音频文件超过 3MB，请缩短录音时长' };
    }

    const text = await recognizeWithSentenceRecognition(inputBuffer, format || 'mp3');
    if (!text.trim()) {
      return { code: -1, message: '未能识别到语音内容' };
    }

    return await handleParseText(text, type);
  } catch (err) {
    console.error('[handleParseVoiceBase64] ASR 失败:', err);
    return { code: -1, message: '语音识别失败: ' + (err.message || err) };
  }
}

async function handleParseVoice(fileID, type) {
  if (!fileID) {
    return { code: -1, message: '音频 fileID 为空' };
  }

  try {
    const downloadRes = await cloud.downloadFile({ fileID });
    const buffer = downloadRes.fileContent;
    if (!buffer || !buffer.length) {
      return { code: -1, message: '音频文件下载失败' };
    }

    console.log('[handleParseVoice] audio buffer length:', buffer.length);

    if (buffer.length > 3 * 1024 * 1024) {
      return { code: -1, message: '音频文件超过 3MB，请缩短录音时长' };
    }

    const text = await recognizeWithSentenceRecognition(buffer, 'mp3');
    if (!text.trim()) {
      return { code: -1, message: '未能识别到语音内容' };
    }

    return await handleParseText(text, type);
  } catch (err) {
    console.error('[handleParseVoice] ASR 失败:', err);
    return { code: -1, message: '语音识别失败: ' + (err.message || err) };
  }
}

async function recognizeWithSentenceRecognition(audioBuffer, format) {
  const client = createAsrClient();

  // 腾讯云一句话识别支持 mp3/aac/m4a/wav/pcm 等格式
  const voiceFormat = format === 'aac' || format === 'm4a' ? 'm4a' : 'mp3';
  const base64Audio = audioBuffer.toString('base64');

  const params = {
    ProjectId: 0,
    SubServiceType: 2,
    EngSerViceType: '16k_zh',
    SourceType: 1,
    VoiceFormat: voiceFormat,
    UsrAudioKey: `jishika_${Date.now()}`,
    Data: base64Audio,
    DataLen: audioBuffer.length
  };

  console.log('[recognizeWithSentenceRecognition] 提交一句话识别，format:', voiceFormat, 'length:', audioBuffer.length);
  const asrRes = await client.SentenceRecognition(params);
  console.log('[recognizeWithSentenceRecognition] ASR 结果:', JSON.stringify(asrRes));

  const text = asrRes && asrRes.Result ? asrRes.Result : '';
  return text.trim();
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
