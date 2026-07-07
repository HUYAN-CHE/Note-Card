const store = require('../../utils/store.js');

const STATUS_MAP = {
  '进行中': 'doing',
  '待确认': 'todo',
  '待开始': 'todo',
  '已完成': 'done'
};

Page({
  data: {
    cardId: '',
    view: 'network',
    card: {},
    creator: { nickname: '', avatar: '', initial: '?', relationText: '创立者' },
    helpers: [],
    keyPoints: [],
    statusClass: 'doing',
    isCreator: false,
    isNetworkView: true,
    showApplySheet: false,
    applyMessage: '',
    userName: '我',
    loading: false
  },

  onLoad(options) {
    const cardId = options.id || '';
    const view = options.view || 'network';
    this.setData({ cardId, view, userName: this.getUserName() });
    if (cardId) {
      this.loadCard(cardId);
    } else {
      wx.showToast({ title: '缺少卡片ID', icon: 'none' });
    }
  },

  async loadCard(id) {
    this.setData({ loading: true });
    try {
      const card = await store.getCard(id) || {};
      const creator = this.normalizeUser(card.creatorId || card.creator || '未知用户');
      creator.relationText = this.getRelationText(creator, this.data.view);
      const helpers = (card.helperIds || card.helpers || []).map(h => this.normalizeUser(h));
      const keyPoints = Array.isArray(card.keyPoints) ? card.keyPoints : [];
      const status = card.status || card.stage || '进行中';
      const statusClass = STATUS_MAP[status] || 'doing';
      const isCreator = this.isCurrentUser(creator.id || creator.nickname);
      const isNetworkView = this.data.view === 'network' && !isCreator;
      this.setData({
        card,
        creator,
        helpers,
        keyPoints,
        statusClass,
        isCreator,
        isNetworkView
      });
    } catch (e) {
      console.error('loadCard error', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  normalizeUser(raw) {
    if (!raw) return { nickname: '未知用户', avatar: '', initial: '?', isMe: false };
    if (typeof raw === 'string') {
      return {
        nickname: raw,
        avatar: '',
        initial: this.getInitial(raw),
        isMe: this.isCurrentUser(raw)
      };
    }
    return {
      id: raw.id || raw._openid || '',
      nickname: raw.nickname || raw.name || '未知用户',
      avatar: raw.avatar || raw.avatarUrl || '',
      initial: this.getInitial(raw.nickname || raw.name),
      isMe: this.isCurrentUser(raw.id || raw._openid || raw.nickname)
    };
  },

  getRelationText(creator, view) {
    if (creator.isMe) return '我 · 创立者';
    if (view === 'network') return '二度人脉 · 创立者';
    return '一度人脉 · 创立者';
  },

  isCurrentUser(value) {
    if (!value) return false;
    const myProfile = wx.getStorageSync('my_profile') || {};
    const myName = myProfile.nickname || '';
    const openid = (getApp().globalData && getApp().globalData.openid) || wx.getStorageSync('JISHIKA_OPENID') || '';
    return value === myName || value === openid;
  },

  getUserName() {
    const myProfile = wx.getStorageSync('my_profile') || {};
    return myProfile.nickname || '我';
  },

  getInitial(name) {
    if (!name) return '?';
    return String(name).trim().charAt(0).toUpperCase() || '?';
  },

  openApplySheet() {
    this.setData({ showApplySheet: true, applyMessage: '' });
  },

  closeApplySheet() {
    this.setData({ showApplySheet: false });
  },

  onApplyInput(e) {
    this.setData({ applyMessage: e.detail.value });
  },

  noop() {},

  onShareAppMessage() {
    const { card, applyMessage } = this.data;
    const title = applyMessage
      ? `${this.data.userName} 想加入《${card.projectName || card.title || '这张记事卡'}》：${applyMessage}`
      : `${this.data.userName} 想加入《${card.projectName || card.title || '这张记事卡'}》，请帮我引荐～`;
    return {
      title,
      path: `/pages/card-detail/card-detail?id=${card.id || this.data.cardId}`,
      imageUrl: ''
    };
  }
});
