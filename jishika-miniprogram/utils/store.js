const { collections } = require('../config/env');

const CARDS_KEY = 'JISHIKA_CARDS';

function uid(prefix = 'card') {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}

function nowText() {
  const date = new Date();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

async function getCards() {
  if (isCloudReady()) {
    try {
      const db = wx.cloud.database();
      const res = await db.collection(collections.cards)
        .orderBy('updatedAt', 'desc')
        .limit(50)
        .get();

      return (res.data || []).map(normalizeCloudCard);
    } catch (error) {
      setStoreMode('local');
    }
  }

  return getLocalCards();
}

async function getCard(id) {
  if (!id) return null;

  if (isCloudReady()) {
    try {
      const card = await findCloudCardById(id);
      if (card) return normalizeCloudCard(card);
    } catch (error) {
      setStoreMode('local');
    }
  }

  return getLocalCard(id);
}

async function saveCard(card) {
  const creatorId = card.creatorId || getCurrentOpenid();
  const nextCard = {
    ...card,
    id: card.id || uid(),
    creatorId,
    helperIds: card.helperIds || [],
    visibility: card.visibility || 'friends',
    updatedAt: Date.now(),
    updatedText: nowText()
  };

  if (isCloudReady()) {
    try {
      await upsertCloudCard(nextCard);
      return nextCard;
    } catch (error) {
      setStoreMode('local');
    }
  }

  return saveLocalCard(nextCard);
}

function getCurrentOpenid() {
  try {
    const app = getApp();
    return (app.globalData && app.globalData.openid) || wx.getStorageSync('JISHIKA_OPENID') || '';
  } catch (error) {
    return '';
  }
}

async function createCardFromDraft(draft) {
  return saveCard({
    ...draft,
    id: uid(),
    status: draft.status || 'draft',
    stage: draft.stage || '待商家确认',
    customerVisible: true,
    internalNote: '',
    progressNodes: draft.progressNodes || buildDefaultNodes(draft.type),
    creatorId: getCurrentOpenid(),
    helperIds: draft.helperIds || [],
    visibility: draft.visibility || 'friends'
  });
}

async function updateCard(id, patch) {
  const card = await getCard(id);
  if (!card) return null;

  return saveCard({
    ...card,
    ...patch
  });
}

function getLocalCards() {
  const cards = wx.getStorageSync(CARDS_KEY) || [];
  return cards.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function getLocalCard(id) {
  return getLocalCards().find((card) => card.id === id);
}

function saveLocalCard(card) {
  const cards = getLocalCards();
  const nextCard = {
    ...card,
    id: card.id || uid(),
    updatedAt: card.updatedAt || Date.now(),
    updatedText: card.updatedText || nowText()
  };
  const index = cards.findIndex((item) => item.id === nextCard.id);

  if (index >= 0) {
    cards[index] = nextCard;
  } else {
    cards.unshift({
      ...nextCard,
      createdAt: nextCard.createdAt || Date.now()
    });
  }

  wx.setStorageSync(CARDS_KEY, cards);
  return nextCard;
}

function buildDefaultNodes(type) {
  if (type === 'meeting') {
    return [
      { id: uid('node'), title: '确认沟通主题', status: 'done' },
      { id: uid('node'), title: '确认会议时间', status: 'current' },
      { id: uid('node'), title: '记录会议结论', status: 'todo' }
    ];
  }

  if (type === 'todo') {
    return [
      { id: uid('node'), title: '整理群聊事项', status: 'done' },
      { id: uid('node'), title: '明确负责人和截止时间', status: 'current' },
      { id: uid('node'), title: '同步完成结果', status: 'todo' }
    ];
  }

  return [
    { id: uid('node'), title: '需求确认', status: 'current' },
    { id: uid('node'), title: '资料补充', status: 'todo' },
    { id: uid('node'), title: '阶段沟通', status: 'todo' },
    { id: uid('node'), title: '服务完成', status: 'todo' }
  ];
}

async function ensureDemoCards() {
  const cards = await getCards();
  if (cards.length) return cards;

  const demo = await createCardFromDraft({
    type: 'requirement',
    typeLabel: '需求确认卡',
    source: 'demo',
    customerName: '王女士',
    phone: '13800001234',
    projectName: '官网改版',
    summary: '客户希望重做企业官网，重点关注移动端适配和品牌感。',
    keyPoints: ['移动端适配', '提升品牌感', '希望 6 月底前上线'],
    questions: ['是否包含文案？', '是否需要多语言？'],
    nextStep: '发给客户确认需求',
    reminderText: '明天 10:00 跟进客户确认'
  });

  return [demo];
}

function isCloudReady() {
  try {
    const app = getApp();
    return Boolean(app.globalData && app.globalData.cloudReady && wx.cloud);
  } catch (error) {
    return false;
  }
}

function setStoreMode(mode) {
  try {
    const app = getApp();
    app.globalData.storeMode = mode;
    if (mode === 'local') app.globalData.cloudReady = false;
  } catch (error) {}
}

async function findCloudCardById(id) {
  const db = wx.cloud.database();
  const res = await db.collection(collections.cards)
    .where({ id })
    .limit(1)
    .get();

  return res.data && res.data[0] ? res.data[0] : null;
}

async function upsertCloudCard(card) {
  const db = wx.cloud.database();
  const existing = await findCloudCardById(card.id);
  const data = stripCloudMeta(card);

  try {
    await upsertCustomerFromCard(card);
  } catch (error) {}

  if (existing && existing._id) {
    return db.collection(collections.cards)
      .doc(existing._id)
      .update({
        data
      });
  }

  return db.collection(collections.cards).add({
    data
  });
}

async function upsertCustomerFromCard(card) {
  if (!card.phone) return null;

  const db = wx.cloud.database();
  const res = await db.collection(collections.customers)
    .where({ phone: card.phone })
    .limit(1)
    .get();

  const data = {
    phone: card.phone,
    customerName: card.customerName || '',
    updatedAt: Date.now(),
    updatedText: nowText()
  };

  if (res.data && res.data[0] && res.data[0]._id) {
    return db.collection(collections.customers)
      .doc(res.data[0]._id)
      .update({
        data
      });
  }

  return db.collection(collections.customers).add({
    data: {
      ...data,
      createdAt: Date.now()
    }
  });
}

function normalizeCloudCard(card) {
  if (!card) return card;

  return {
    ...card,
    cloudId: card._id
  };
}

function stripCloudMeta(card) {
  const data = {
    ...card
  };
  delete data._id;
  delete data.cloudId;
  return data;
}

module.exports = {
  getCards,
  getCard,
  saveCard,
  updateCard,
  createCardFromDraft,
  ensureDemoCards,
  buildDefaultNodes,
  nowText
};
