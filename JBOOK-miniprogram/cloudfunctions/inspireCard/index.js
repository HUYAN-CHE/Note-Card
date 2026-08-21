// 灵感卡云函数：list / detail / create / addSpark / summarize / update
// 数据模型：{ creatorId, title, subtitle, keywords[], status, sparks[{text,createdAt}], article, color, createdAt, updatedAt }
// title/subtitle/keywords/article 由 AI 提取；status: collecting(集灵中) / exported(已输出)，用户在文章页手动选择
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COLLECTION = 'inspireCards';
const STATUS_ENUM = ['collecting', 'exported'];
// 卡片配色板，创建时按用户已有卡数量循环分配（8 色 pastel 系，顺序按色相间隔排列，
// 保证列表相邻、瀑布流同列（序号差 2）都协调不撞色）
const COLOR_PALETTE = [
  '#cfe8fb', // 浅蓝
  '#f6dfb8', // 浅黄
  '#dcd3f0', // 浅紫
  '#c9efdd', // 浅绿
  '#c9e9ef', // 浅青
  '#fbd8cf', // 浅珊瑚
  '#d8ecc7', // 浅豆绿
  '#f2d3e6'  // 浅玫粉
];

const SYSTEM_PROMPT = '你是一个灵感整理助手。用户平时把零碎的灵感逐条发给你，你需要把它们汇总成一篇文章。请基于用户提供的全部灵感条目提取四个字段，只返回 JSON：title 是这组灵感共同主题的简短标题（5-15字）；subtitle 是一句话副标题（20-40字），概括这组灵感的核心方向；keywords 是主题关键词数组，数量 1-7 个不等，按内容实际涉及的主题提炼，不要硬凑；每个 2-8 个字，按重要性从高到低排序；article 是把所有灵感条目串联整理成的一篇通顺文章（200-500字），【铁律：article 只能基于条目原文提炼融合，禁止补充条目之外的任何信息、观点、案例或细节；条目单薄时文章就写短，宁短勿编】，段落之间用 \\n\\n 分隔。';

exports.main = async (event, context) => {
  console.log('[inspireCard] 收到请求', JSON.stringify({ action: event.action, id: event.id }));

  let openid = cloud.getWXContext().OPENID;
  // 系统通道：wecomIngest 云函数间调用私聊灵感沉淀（无小程序用户上下文），
  // 凭 systemKey（与 wecomIngest 的 INGEST_SYSTEM_KEY 一致）+ 显式 event.openid 放行，仅限 ingestSpark
  if (!openid && event.action === 'ingestSpark' && (event.systemKey || '') === (process.env.INGEST_SYSTEM_KEY || 'jishika-ingest-2026')) {
    openid = (event.openid || '').trim();
  }
  if (!openid) {
    return { code: -1, message: '未获取到用户身份' };
  }

  try {
    switch (event.action) {
      case 'list':
        return await listCards(openid);
      case 'detail':
        return await getDetail(openid, event.id);
      case 'create':
        return await createCard(openid, event.text);
      case 'addSpark':
        return await addSpark(openid, event.id, event.text);
      case 'summarize':
        return await summarize(openid, event.id);
      case 'update':
        return await updateCard(openid, event);
      case 'ingestSpark':
        return await ingestSpark(openid, event.text);
      case 'removeSpark':
        return await removeSpark(openid, event.id, event.index);
      case 'delete':
        return await deleteCard(openid, event.id);
      default:
        return { code: -1, message: '未知 action' };
    }
  } catch (err) {
    console.error('[inspireCard] 错误', err);
    return { code: -1, message: '云函数内部错误: ' + (err.message || err.stack || JSON.stringify(err)) };
  }
};

// 当前用户全部灵感卡，按创建时间倒序（颜色创建时按 4 色板循环分配，顺序固定即保证相邻不同色）；列表不含 article 正文
async function listCards(openid) {
  const res = await db.collection(COLLECTION)
    .where({ creatorId: openid })
    .field({ article: false })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  return { code: 0, data: { cards: res.data.map(normalizeCard) } };
}

async function getDetail(openid, id) {
  const card = await loadOwnedCard(openid, id);
  if (!card) return { code: -1, message: '灵感卡不存在' };
  return { code: 0, data: { card: normalizeCard(card) } };
}

// 新建灵感卡，可带首条灵感；有首条灵感时自动做一次 AI 提取，生成初始标题/副标题/关键词
// source：碎片来源（wecom-text 私聊 / wecom-chatrecord 转发 / wecom-voice 语音 / manual 手动）
async function createCard(openid, text, source) {
  const now = new Date().toISOString();
  const firstText = (text || '').trim();
  const countRes = await db.collection(COLLECTION).where({ creatorId: openid }).count();

  const card = {
    creatorId: openid,
    title: '',
    subtitle: '',
    keywords: [],
    status: 'collecting',
    sparks: firstText ? [{ text: firstText, createdAt: now, source: source || 'manual' }] : [],
    article: '',
    color: COLOR_PALETTE[countRes.total % COLOR_PALETTE.length],
    createdAt: now,
    updatedAt: now
  };

  const addRes = await db.collection(COLLECTION).add({ data: card });
  const id = addRes._id;

  if (firstText) {
    const sumRes = await runSummarize(openid, id);
    if (sumRes.code === 0) return { code: 0, data: { card: sumRes.data.card } };
    // AI 失败不阻塞建卡，返回未提取的初始卡
    console.warn('[createCard] 首次 summarize 失败', sumRes.message);
  }

  const detail = await getDetail(openid, id);
  return { code: 0, data: { card: detail.data.card } };
}

// 追加一条零碎灵感；卡片还没有标题时自动补一次 AI 提取
// source：碎片来源（wecom-text 私聊 / wecom-chatrecord 转发 / wecom-voice 语音 / manual 手动）
async function addSpark(openid, id, text, source) {
  const sparkText = (text || '').trim();
  if (!sparkText) return { code: -1, message: '灵感内容为空' };

  const card = await loadOwnedCard(openid, id);
  if (!card) return { code: -1, message: '灵感卡不存在' };

  await db.collection(COLLECTION).doc(id).update({
    data: {
      sparks: _.push([{ text: sparkText, createdAt: new Date().toISOString(), source: source || 'manual' }]),
      updatedAt: new Date().toISOString()
    }
  });

  if (!card.title) {
    const sumRes = await runSummarize(openid, id);
    if (sumRes.code === 0) return { code: 0, data: { card: sumRes.data.card } };
    console.warn('[addSpark] 自动 summarize 失败', sumRes.message);
  }

  const detail = await getDetail(openid, id);
  return { code: 0, data: { card: detail.data.card } };
}

// AI 提取：根据全部灵感条目生成 标题/副标题/关键词/文章，写回卡片（不动 status）
async function summarize(openid, id) {
  return runSummarize(openid, id);
}

async function runSummarize(openid, id) {
  const card = await loadOwnedCard(openid, id);
  if (!card) return { code: -1, message: '灵感卡不存在' };

  const sparks = Array.isArray(card.sparks) ? card.sparks : [];
  if (!sparks.length) return { code: -1, message: '还没有灵感内容，无法整理' };

  const sparkText = sparks.map((s, i) => `${i + 1}. ${s.text}`).join('\n');
  const rawText = await callTextModel(sparkText);
  const parsed = extractJSON(rawText);

  const fields = {
    title: parsed.title || card.title || '未命名灵感',
    subtitle: parsed.subtitle || '',
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter(Boolean).slice(0, 7) : [],
    // 融合文章门槛：少于 3 条碎片不生成——素材太少时 AI 必然脑补，宁缺毋滥
    article: sparks.length >= 3 ? (parsed.article || '') : '',
    updatedAt: new Date().toISOString()
  };

  await db.collection(COLLECTION).doc(id).update({ data: fields });

  const detail = await getDetail(openid, id);
  return { code: 0, data: { card: detail.data.card } };
}

// 保存文章页编辑：标题/副标题/关键词/文章/状态（白名单字段）
async function updateCard(openid, event) {
  const card = await loadOwnedCard(openid, event.id);
  if (!card) return { code: -1, message: '灵感卡不存在' };

  const fields = {};
  if (typeof event.title === 'string') fields.title = event.title.trim();
  if (typeof event.subtitle === 'string') fields.subtitle = event.subtitle.trim();
  if (Array.isArray(event.keywords)) fields.keywords = event.keywords.filter(Boolean).slice(0, 7);
  if (typeof event.article === 'string') fields.article = event.article;
  if (STATUS_ENUM.indexOf(event.status) !== -1) fields.status = event.status;

  if (!Object.keys(fields).length) return { code: -1, message: '没有需要更新的字段' };

  fields.updatedAt = new Date().toISOString();
  await db.collection(COLLECTION).doc(event.id).update({ data: fields });

  const detail = await getDetail(openid, event.id);
  return { code: 0, data: { card: detail.data.card } };
}

// 读取卡片并校验归属
async function loadOwnedCard(openid, id) {
  if (!id) return null;
  try {
    const res = await db.collection(COLLECTION).doc(id).get();
    const card = res.data;
    if (!card || card.creatorId !== openid) return null;
    return card;
  } catch (err) {
    return null;
  }
}

// 统一输出结构：_id -> id，sparks 兜底空数组
function normalizeCard(card) {
  return {
    id: card._id,
    title: card.title || '',
    subtitle: card.subtitle || '',
    keywords: Array.isArray(card.keywords) ? card.keywords : [],
    status: STATUS_ENUM.indexOf(card.status) !== -1 ? card.status : 'collecting',
    sparks: Array.isArray(card.sparks) ? card.sparks : [],
    article: typeof card.article === 'string' ? card.article : '',
    color: card.color || COLOR_PALETTE[0],
    creatorId: card.creatorId,
    createdAt: card.createdAt || '',
    updatedAt: card.updatedAt || ''
  };
}

async function callTextModel(sparkText) {
  const model = cloud.ai().createModel('cloudbase');
  const res = await model.generateText({
    model: 'hy3',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `以下是用户记录的全部灵感条目，请汇总整理：\n\n${sparkText}` }
    ]
  });

  console.log('[callTextModel] AI 原始返回:', res.text);
  return res.text;
}

// 与 parseContext 相同的 JSON 容错解析
function extractJSON(rawText) {
  try {
    return JSON.parse(rawText);
  } catch (e) {
    const cleaned = rawText
      .replace(/```json\s*/gi, '')
      .replace(/```\s*$/gm, '')
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch (e2) {
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('AI 返回无法解析为 JSON: ' + rawText.substring(0, 200));
    }
  }
}

// 私聊灵感沉淀入口（wecomIngest 云函数间调用，系统通道）：按主题归集
// 简单版匹配：碎片文本命中现有 collecting 卡的 keyword/title 词（≥2 字）即归入；否则新建卡
// source：消息类型 text 私聊 / chatrecord 转发 / voice 语音（碎片原文按来源分段展示用）
async function ingestSpark(openid, text, source) {
  const sparkText = (text || '').trim();
  if (!sparkText) return { code: -1, message: '灵感内容为空' };
  const sparkSource = source ? 'wecom-' + source : 'wecom-text';

  const res = await db.collection(COLLECTION)
    .where({ creatorId: openid, status: 'collecting' })
    .field({ title: true, keywords: true })
    .orderBy('updatedAt', 'desc')
    .limit(20)
    .get();
  const cards = res.data || [];

  const hit = cards.find((c) => {
    const words = [c.title, ...(c.keywords || [])].filter(Boolean);
    return words.some((w) => w.length >= 2 && sparkText.includes(w));
  });

  if (hit) {
    const r = await addSpark(openid, hit._id, sparkText, sparkSource);
    if (r.code !== 0) return r;
    return { code: 0, data: { cardId: hit._id, matched: true, title: hit.title || '' } };
  }

  const created = await createCard(openid, sparkText, sparkSource);
  const card = created.data && created.data.card;
  return { code: 0, data: { cardId: (card && card.id) || '', matched: false, title: (card && card.title) || '' } };
}

// 删除指定碎片（灵感详情页「转记事」成功后清理，避免一条内容两边都在）；index 为 sparks 下标
async function removeSpark(openid, id, index) {
  const card = await loadOwnedCard(openid, id);
  if (!card) return { code: -1, message: '灵感卡不存在' };
  const sparks = Array.isArray(card.sparks) ? card.sparks.slice() : [];
  const i = Number(index);
  if (!(i >= 0 && i < sparks.length)) return { code: -1, message: '碎片不存在' };
  sparks.splice(i, 1);
  await db.collection(COLLECTION).doc(id).update({
    data: { sparks, updatedAt: new Date().toISOString() }
  });
  return { code: 0, data: { left: sparks.length } };
}

// 删除整张灵感卡（仅本人）
async function deleteCard(openid, id) {
  const card = await loadOwnedCard(openid, id);
  if (!card) return { code: -1, message: '灵感卡不存在' };
  await db.collection(COLLECTION).doc(id).remove();
  return { code: 0, data: { removed: 1 } };
}
