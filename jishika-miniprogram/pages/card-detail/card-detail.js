const store = require('../../utils/store.js');

const STATUS_MAP = {
  draft: { text: '待确认', class: 'todo' },
  todo: { text: '待确认', class: 'todo' },
  doing: { text: '进行中', class: 'doing' },
  done: { text: '已完成', class: 'done' }
};

Page({
  data: {
    cardId: '',
    card: {},
    creator: { nickname: '', avatar: '', initial: '?', relationText: '创立者' },
    helpers: [],
    keyPoints: [],
    statusClass: 'doing',
    statusText: '进行中',
    role: 'stranger',
    isCreator: false,
    isHelper: false,
    isNetworkView: false,
    canAcceptInvite: false,
    showApplySheet: false,
    applyMessage: '',
    userName: '我',
    loading: false,
    helperOpenid: ''
  },

  onLoad(options) {
    const cardId = options.id || '';
    const helperOpenid = options.helperOpenid || '';
    this.setData({
      cardId,
      helperOpenid,
      userName: this.getUserName()
    });

    if (cardId) {
      this.loadCard(cardId);
    } else {
      wx.showToast({ title: '缺少卡片ID', icon: 'none' });
    }
  },

  async loadCard(id) {
    this.setData({ loading: true });

    try {
      const app = getApp();
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const res = await wx.cloud.callFunction({
          name: 'getCardDetail',
          data: { id }
        });

        if (res.result && res.result.code === 0) {
          this.renderCard(res.result.data);
          return;
        }
      }

      // 本地兜底
      const card = await store.getCard(id) || {};
      this.renderLocalCard(card);
    } catch (e) {
      console.error('loadCard error', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  renderCard(data) {
    const role = data.role || 'stranger';
    const isCreator = role === 'creator';
    const isHelper = role === 'helper';
    const isNetworkView = role === 'network';

    const statusInfo = STATUS_MAP[data.status] || { text: data.status || '进行中', class: 'doing' };
    const keyPoints = Array.isArray(data.keyPoints) ? data.keyPoints : [];

    this.setData({
      card: data,
      creator: data.creator || this.data.creator,
      helpers: data.helpers || [],
      keyPoints,
      statusClass: statusInfo.class,
      statusText: statusInfo.text,
      role,
      isCreator,
      isHelper,
      isNetworkView,
      canAcceptInvite: role === 'stranger' && !isNetworkView
    });
  },

  renderLocalCard(card) {
    const creator = this.normalizeUser(card.creatorId || card.creator || '未知用户');
    const helpers = (card.helperIds || card.helpers || []).map((h) => this.normalizeUser(h));
    const keyPoints = Array.isArray(card.keyPoints) ? card.keyPoints : [];
    const statusInfo = STATUS_MAP[card.status] || { text: card.status || '进行中', class: 'doing' };

    const openid = this.getCurrentOpenid();
    const isCreator = card.creatorId === openid;
    const isHelper = Array.isArray(card.helperIds) && card.helperIds.includes(openid);

    this.setData({
      card,
      creator,
      helpers,
      keyPoints,
      statusClass: statusInfo.class,
      statusText: statusInfo.text,
      role: isCreator ? 'creator' : (isHelper ? 'helper' : 'stranger'),
      isCreator,
      isHelper,
      isNetworkView: false,
      canAcceptInvite: !isCreator && !isHelper
    });
  },

  normalizeUser(raw) {
    if (!raw) return { nickname: '未知用户', avatar: '', initial: '?', isMe: false };
    if (typeof raw === 'string') {
      return {
        id: raw,
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

  getRelationText() {
    if (this.data.isCreator) return '我 · 创立者';
    if (this.data.isHelper) return '一度人脉 · 协助者';
    if (this.data.isNetworkView) return '二度人脉 · 创立者';
    return '创立者';
  },

  isCurrentUser(value) {
    if (!value) return false;
    const openid = this.getCurrentOpenid();
    const myProfile = wx.getStorageSync('JISHIKA_USER_PROFILE') || {};
    return value === myProfile.nickname || value === openid;
  },

  getCurrentOpenid() {
    try {
      return (getApp().globalData && getApp().globalData.openid) || wx.getStorageSync('JISHIKA_OPENID') || '';
    } catch (e) {
      return '';
    }
  },

  getUserName() {
    const myProfile = wx.getStorageSync('JISHIKA_USER_PROFILE') || {};
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

  async submitApply() {
    const { cardId, helperOpenid, applyMessage } = this.data;

    if (!helperOpenid) {
      wx.showToast({ title: '缺少引荐人信息', icon: 'none' });
      return;
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'applyToJoinCard',
        data: {
          cardId,
          intermediaryId: helperOpenid,
          note: applyMessage
        }
      });

      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '申请已提交', icon: 'success' });
        this.closeApplySheet();
      } else {
        wx.showToast({ title: res.result.message || '申请失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '申请失败', icon: 'none' });
    }
  },

  async acceptInvite() {
    const { cardId } = this.data;
    if (!cardId) return;

    try {
      const res = await wx.cloud.callFunction({
        name: 'inviteHelper',
        data: { cardId }
      });

      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '已加入', icon: 'success' });
        this.loadCard(cardId);
      } else {
        wx.showToast({ title: res.result.message || '加入失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '加入失败', icon: 'none' });
    }
  },

  noop() {},

  onShareAppMessage() {
    const { card, applyMessage, userName } = this.data;
    const title = applyMessage
      ? `${userName} 想加入《${card.title || '这张记事卡'}》：${applyMessage}`
      : `${userName} 想加入《${card.title || '这张记事卡'}》，请帮我引荐～`;
    return {
      title,
      path: `/pages/card-detail/card-detail?id=${card.id || this.data.cardId}`,
      imageUrl: ''
    };
  }
});
