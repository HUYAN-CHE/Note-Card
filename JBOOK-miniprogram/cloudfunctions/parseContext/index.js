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

// 主题场景分类枚举（与 utils/theme-icon.js 的 THEME_ICONS 保持一致）
const THEME_ENUM = [
  'camp', 'wedding', 'baby', 'school', 'pet', 'car', 'travel', 'express', 'move',
  'house', 'repair', 'plant', 'food', 'cook', 'entertainment', 'movie', 'game',
  'sport', 'beauty', 'shopping', 'gift', 'photo', 'study', 'job', 'meeting',
  'design', 'work', 'money', 'finance', 'insurance', 'legal', 'document',
  'volunteer', 'health', 'default'
];

const SYSTEM_PROMPT = '你是一个智能记事卡解析助手。请从用户输入的文本中提取六个字段，只返回 JSON，结构示例：{"title":"周五前发设计稿","desc":"需要在周五前把设计稿发送给客户","keyPoints":["设计稿","客户交付"],"theme":"work","deadline":"2026-08-21","kind":"note"}。字段要求：title 简短标题（5-15字）；desc 通顺描述（保留关键细节）；keyPoints 主题关键词数组，每个 2-8 字，最多 5 个，按重要性排序；theme 场景分类唯一枚举：camp(露营户外) wedding(婚礼) baby(育儿) school(学校) pet(宠物) car(车辆接送) travel(旅行) express(快递) move(搬家) house(租房居家) repair(维修家政) plant(植物) food(聚餐美食) cook(做饭) entertainment(娱乐夜场) movie(电影演出) game(游戏) sport(运动) beauty(美容) shopping(购物) gift(礼物祝福) photo(拍照) study(学习考试) job(求职入职) meeting(会议沟通) design(设计装修) work(项目工作) money(费用报销) finance(理财) insurance(保险) legal(法律合同) document(证件办理) volunteer(公益) health(医疗健康) default(其他)。deadline 是文本中明确提到的截止或提醒日期，格式必须严格为 YYYY-MM-DD（如"明天""这周五""下周三前"按用户消息里的当前日期推算），没有明确时间信息时返回空字符串 ""，不要返回其它格式。kind 判定内容进"记事卡"还是"灵感库"：内容是事项、待办、约定、需要跟进或提醒的行动时返回 "note"；内容明显只是想法、创意、素材、感受且不含任何待办/事项/行动时返回 "inspire"；拿不准时一律返回 "note"。六个字段一个都不能少。';

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
    console.log('[handleParseVoice] audio header:', header);
    const text = await recognizeAudio(buffer, format || 'mp3');
    if (!text || !text.trim()) {
      return { code: -1, message: '未能识别到语音内容' };
    }

    const parsed = await handleParseText(text, type);
    if (parsed.code === 0) {
      parsed.data.rawText = text;
    }
    return parsed;
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
  // AI 推算"这周五/明天"等相对时间需要锚点：注入北京时间今天（与卡片 deadline 同时区）
  const bj = new Date(Date.now() + 8 * 3600 * 1000);
  const today = `${bj.getUTCFullYear()}-${`${bj.getUTCMonth() + 1}`.padStart(2, '0')}-${`${bj.getUTCDate()}`.padStart(2, '0')}`;

  const res = await model.generateText({
    model: 'hy3',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `请解析以下文本，整理成一张"${typeLabel}"。\n当前日期：${today}\n\n${text}` }
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
      keyPoints: Array.isArray(data.keyPoints) ? data.keyPoints : [],
      theme: THEME_ENUM.indexOf(data.theme) !== -1 ? data.theme : 'default',
      // 截止/提醒日期：仅接受 YYYY-MM-DD，其它一律视为未提取
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(data.deadline || '') ? data.deadline : '',
      // 分流标记：note 记事卡 / inspire 灵感库；AI 未返回或返回非法值时偏置 note（宁可错放记事，不漏事项）
      kind: data.kind === 'inspire' ? 'inspire' : 'note'
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
