const store = require('../../utils/store.js');
const { getNavInfo } = require('../../utils/ui');

const STATUS_MAP = {
  draft: { text: '待确认', class: 'todo' },
  todo: { text: '待确认', class: 'todo' },
  doing: { text: '进行中', class: 'doing' },
  done: { text: '已完成', class: 'done' }
};

function cleanNickname(name) {
  if (!name || String(name).trim() === '我') return '';
  return String(name).trim();
}

function getInitial(name) {
  if (!name) return '';
  return String(name).trim().charAt(0).toUpperCase();
}

Page({
  data: {
    totalHeight: 132,
    cardId: '',
    card: {},
    creator: { nickname: '', avatar: '', initial: '', relationText: '创立者' },
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
    pendingRequests: [],
    loading: false,
    safeAreaBottom: 0
  },

  onLoad(options) {
    const sys = wx.getSystemInfoSync();
    const navInfo = getNavInfo();
    this.setData({
      totalHeight: navInfo.totalHeight,
      safeAreaBottom: sys.safeAreaInsets ? sys.safeAreaInsets.bottom : 0
    });

    const cardId = options.id || '';
    this.setData({ cardId });

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
      canAcceptInvite: role === 'stranger' && !isNetworkView,
      pendingRequests: data.pendingRequests || []
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
      canAcceptInvite: !isCreator && !isHelper,
      pendingRequests: []
    });
  },

  normalizeUser(raw) {
    if (!raw) return { nickname: '未知用户', avatar: '', initial: '', isMe: false };
    if (typeof raw === 'string') {
      return {
        id: raw,
        nickname: raw,
        avatar: '',
        initial: getInitial(raw),
        isMe: this.isCurrentUser(raw)
      };
    }
    return {
      id: raw.id || raw._openid || '',
      nickname: cleanNickname(raw.nickname || raw.name) || '未知用户',
      avatar: raw.avatar || raw.avatarUrl || '',
      initial: getInitial(raw.nickname || raw.name),
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
    return value === cleanNickname(myProfile.nickname) || value === openid;
  },

  getCurrentOpenid() {
    try {
      return (getApp().globalData && getApp().globalData.openid) || wx.getStorageSync('JISHIKA_OPENID') || '';
    } catch (e) {
      return '';
    }
  },

  // 申请加入
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
    const { cardId, applyMessage } = this.data;
    if (!cardId) return;

    try {
      const res = await wx.cloud.callFunction({
        name: 'applyToJoinCard',
        data: { cardId, note: applyMessage }
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

  // 接受邀请
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

  // 审批申请
  async approveRequest(e) {
    const requestId = e.currentTarget.dataset.id;
    const approved = e.currentTarget.dataset.approved;

    try {
      const res = await wx.cloud.callFunction({
        name: 'approveJoinRequest',
        data: { requestId, approved }
      });

      if (res.result && res.result.code === 0) {
        wx.showToast({ title: approved ? '已通过' : '已拒绝', icon: 'success' });
        this.loadCard(this.data.cardId);
      } else {
        wx.showToast({ title: res.result.message || '操作失败', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 标记完成
  async completeCard() {
    const { cardId, card } = this.data;
    if (!cardId) return;

    try {
      const res = await wx.cloud.callFunction({
        name: 'updateCard',
        data: { id: cardId, status: 'done' }
      });

      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '已标记完成', icon: 'success' });
        this.loadCard(cardId);
      } else {
        wx.showToast({ title: res.result.message || '操作失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 编辑
  editCard() {
    const { cardId } = this.data;
    if (cardId) {
      wx.navigateTo({ url: `/pages/card-edit/card-edit?id=${cardId}` });
    }
  },

  // 邀请 / 介绍给朋友
  inviteFriend() {
    wx.showShareMenu({ withShareTicket: true });
  },

  noop() {},

  onShareAppMessage() {
    const { card, role } = this.data;
    const title = card.title
      ? `邀请你一起用《${card.title}》`
      : '邀请你一起用记事卡';
    return {
      title,
      path: card.id ? `/pages/card-detail/card-detail?id=${card.id}` : '/pages/home/home',
      imageUrl: '/assets/logo.png'
    };
  }
});
