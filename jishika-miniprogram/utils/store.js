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

function getCurrentOpenid() {
  try {
    const app = getApp();
    return (app.globalData && app.globalData.openid) || wx.getStorageSync('JISHIKA_OPENID') || '';
  } catch (error) {
    return '';
  }
}

function normalizeCard(card) {
  if (!card) return card;
  return {
    ...card,
    cloudId: card._id || card.cloudId
  };
}

function stripCloudMeta(card) {
  const data = { ...card };
  delete data._id;
  delete data.cloudId;
  return data;
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

// ==================== 本地存储 ====================

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

// ==================== 云数据库 ====================

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

  if (existing && existing._id) {
    return db.collection(collections.cards)
      .doc(existing._id)
      .update({ data });
  }

  return db.collection(collections.cards).add({ data });
}

// ==================== 卡片 CRUD ====================

async function getCards() {
  if (isCloudReady()) {
    try {
      const db = wx.cloud.database();
      const openid = getCurrentOpenid();
      const res = await db.collection(collections.cards)
        .where({
          $or: [
            { creatorId: openid },
            { helperIds: openid }
          ]
        })
        .orderBy('updatedAt', 'desc')
        .limit(100)
        .get();
      return (res.data || []).map(normalizeCard);
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
      if (card) return normalizeCard(card);
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
    helperIds: Array.isArray(card.helperIds) ? card.helperIds : [],
    isNetworkVisible: card.isNetworkVisible !== false,
    status: card.status || 'draft',
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

async function createCardFromDraft(draft) {
  return saveCard({
    ...draft,
    id: uid(),
    status: draft.status || 'draft',
    helperIds: draft.helperIds || [],
    isNetworkVisible: draft.isNetworkVisible !== false,
    source: draft.source || 'manual'
  });
}

async function updateCard(id, patch) {
  const card = await getCard(id);
  if (!card) return null;
  return saveCard({ ...card, ...patch });
}

async function deleteCard(id) {
  if (!id) return;

  if (isCloudReady()) {
    try {
      const existing = await findCloudCardById(id);
      if (existing && existing._id) {
        await wx.cloud.database()
          .collection(collections.cards)
          .doc(existing._id)
          .remove();
      }
    } catch (error) {
      // 继续清理本地
    }
  }

  const cards = getLocalCards().filter((card) => card.id !== id);
  wx.setStorageSync(CARDS_KEY, cards);
}

// ==================== 用户资料 ====================

async function saveUserProfile(profile) {
  const openid = getCurrentOpenid();
  if (!openid || !isCloudReady() || !wx.cloud) return;

  try {
    const db = wx.cloud.database();
    const res = await db.collection(collections.users)
      .where({ _openid: openid })
      .limit(1)
      .get();

    const data = {
      _openid: openid,
      nickName: profile.nickName || profile.nickname || '',
      avatarUrl: profile.avatarUrl || profile.avatar || '',
      intro: profile.intro || '',
      serviceTags: Array.isArray(profile.serviceTags) ? profile.serviceTags : [],
      initial: profile.initial || getInitial(profile.nickName || profile.nickname),
      color: profile.color || '',
      updatedAt: Date.now()
    };

    if (res.data && res.data[0] && res.data[0]._id) {
      await db.collection(collections.users).doc(res.data[0]._id).update({ data });
    } else {
      await db.collection(collections.users).add({
        data: { ...data, createdAt: Date.now() }
      });
    }
  } catch (error) {
    // 忽略云端失败
  }
}

async function getUserProfile(openid) {
  if (!openid) return null;

  if (isCloudReady()) {
    try {
      const db = wx.cloud.database();
      const res = await db.collection(collections.users)
        .where({ _openid: openid })
        .limit(1)
        .get();
      return res.data && res.data[0] ? res.data[0] : null;
    } catch (error) {
      // fallback to local
    }
  }

  const cached = wx.getStorageSync('JISHIKA_USER_PROFILE') || {};
  if (cached.nickname || cached.nickName) {
    return {
      _openid: openid,
      nickName: cached.nickname || cached.nickName || '',
      avatarUrl: cached.avatar || cached.avatarUrl || '',
      intro: cached.intro || '',
      serviceTags: cached.serviceTags || cached.tags || []
    };
  }

  return null;
}

function getInitial(name) {
  if (!name) return '';
  return String(name).trim().charAt(0).toUpperCase();
}

module.exports = {
  uid,
  nowText,
  getCurrentOpenid,
  getCards,
  getCard,
  saveCard,
  updateCard,
  deleteCard,
  createCardFromDraft,
  saveUserProfile,
  getUserProfile,
  getInitial
};
