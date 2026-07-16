const cloud = require('wx-server-sdk');
const https = require('https');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const TYPE_LABELS = {
  requirement: '需求确认卡',
  progress: '服务进度卡',
  todo: '群聊待办',
  meeting: '预约记录'
};

const SYSTEM_PROMPT = '你是一个智能记事卡解析助手。请从用户输入的文本中提取 title、desc、keyPoints 三个字段，只返回 JSON。title 是简短标题（5-15字），desc 是通顺的描述（保留关键细节），keyPoints 是要点字符串数组（每项一句话）。';

exports.main = async (event, context) => {
  console.log('[parseContext] 收到请求', JSON.stringify({ action: event.action }));

  try {
    if (event.action === 'parseText') {
      return await handleParseText(event.text, event.type);
    }
    if (event.action === 'parseVoice') {
      return await handleParseVoice(event.fileID, event.format, event.type);
    }
    return { code: -1, message: '未知 action' };
  } catch (err) {
    console.error('[parseContext] 错误', err);
    return { code: -1, message: '云函数内部错误: ' + (err.message || err.stack || JSON.stringify(err)) };
  }
};

async function handleParseText(text, type) {
  if (!text || text.trim().length === 0) {
    return { code: -1, message: '文本内容为空' };
  }

  const result = await callTextModel(text, type);
  return extractJSON(result);
}

async function handleParseVoice(fileID, format, type) {
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
      return { code: -1, message: '音频文件超过 3MB' };
    }

    const header = buffer.slice(0, 16).toString('hex');
    const text = await recognizeAudio(buffer, format || 'mp3');
    if (!text || !text.trim()) {
      return { code: -1, message: '未能识别到语音内容' };
    }

    return await handleParseText(text, type);
  } catch (err) {
    console.error('[handleParseVoice] 失败:', err);
    const safeBuffer = typeof buffer !== 'undefined' ? buffer : null;
    return {
      code: -1,
      message: '语音处理失败: ' + (err.message || err),
      debug: {
        fileID,
        format: format || 'mp3',
        bufferLength: safeBuffer ? safeBuffer.length : 0,
        bufferHeader: safeBuffer ? safeBuffer.slice(0, 16).toString('hex') : ''
      }
    };
  }
}

async function callTextModel(text, type) {
  const model = cloud.ai().createModel('cloudbase');
  const typeLabel = TYPE_LABELS[type] || '记事卡';

  const res = await model.generateText({
    model: 'hy3',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `请解析以下文本，整理成一张"${typeLabel}"。\n\n${text}` }
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

// 腾讯云 ASR 一句话识别（HTTPS + TC3-HMAC-SHA256 签名）
function recognizeAudio(audioBuffer, format) {
  return new Promise((resolve, reject) => {
    const secretId = process.env.TENCENT_SECRET_ID;
    const secretKey = process.env.TENCENT_SECRET_KEY;
    if (!secretId || !secretKey) {
      return reject(new Error('腾讯云 ASR 密钥未配置'));
    }

    const host = 'asr.tencentcloudapi.com';
    const service = 'asr';
    const version = '2019-06-14';
    const action = 'SentenceRecognition';
    const region = 'ap-beijing';

    let voiceFormat = detectAudioFormat(audioBuffer, format);
    const payload = JSON.stringify({
      ProjectId: 0,
      SubServiceType: 2,
      EngSerViceType: '16k_zh',
      SourceType: 1,
      VoiceFormat: voiceFormat,
      UsrAudioKey: `jishika_${Date.now()}`,
      Data: audioBuffer.toString('base64'),
      DataLen: audioBuffer.length
    });

    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

    const signedHeaders = 'content-type;host';
    const canonicalHeaders = `content-type:application/json\nhost:${host}\n`;
    const hashedPayload = crypto.createHash('sha256').update(payload).digest('hex');
    const canonicalRequest = [
      'POST',
      '/',
      '',
      canonicalHeaders,
      signedHeaders,
      hashedPayload
    ].join('\n');

    const credentialScope = `${date}/${service}/tc3_request`;
    const hashedCanonicalRequest = crypto.createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;

    const secretDate = hmacSha256(`TC3${secretKey}`, date);
    const secretService = hmacSha256(secretDate, service);
    const secretSigning = hmacSha256(secretService, 'tc3_request');
    const signature = hmacSha256(secretSigning, stringToSign).toString('hex');

    const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const options = {
      hostname: host,
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': host,
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Region': region,
        'X-TC-Timestamp': String(timestamp),
        'Authorization': authorization,
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        console.log('[recognizeAudio] ASR 响应:', body);
        try {
          const data = JSON.parse(body);
          if (data.Response && data.Response.Result) {
            resolve(data.Response.Result.trim());
          } else if (data.Response && data.Response.Error) {
            reject(new Error(`ASR 错误: ${data.Response.Error.Message}`));
          } else {
            reject(new Error('ASR 返回异常: ' + body));
          }
        } catch (e) {
          reject(new Error('ASR 响应解析失败: ' + body));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function hmacSha256(key, msg) {
  return crypto.createHmac('sha256', key).update(msg, 'utf8').digest();
}

// 根据文件头自动推断音频格式，优先于前端传的 format
function detectAudioFormat(buffer, fallbackFormat) {
  if (!buffer || buffer.length < 16) return fallbackFormat || 'mp3';

  const h = buffer.slice(0, 16);
  const hex = h.toString('hex');

  // MP3: ID3 tag or MPEG sync word
  if (hex.startsWith('494433') || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0)) {
    return 'mp3';
  }

  // WAV: RIFF....WAVE
  if (hex.startsWith('52494646') && hex.includes('57415645')) {
    return 'wav';
  }

  // AAC/ADTS: 0xfff
  if (h[0] === 0xff && (h[1] & 0xf0) === 0xf0) {
    return 'm4a';
  }

  // M4A/MP4: ftyp
  if (hex.includes('66747970')) {
    return 'm4a';
  }

  // WebM/Matroska
  if (hex.startsWith('1a45dfa3')) {
    return 'webm';
  }

  // Ogg: OggS
  if (hex.startsWith('4f676753')) {
    return 'ogg-opus';
  }

  // PCM has no header; rely on explicit format hint
  const fmt = (fallbackFormat || 'mp3').toLowerCase();
  if (fmt === 'aac' || fmt === 'm4a') return 'm4a';
  if (fmt === 'wav') return 'wav';
  if (fmt === 'pcm') return 'pcm';
  return 'mp3';
}
