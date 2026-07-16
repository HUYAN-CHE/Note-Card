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

// 截止日期早于今天且未完成时视为已逾期
function checkOverdue(card) {
  if (!card || !card.deadline || card.status === 'done') return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return card.deadline < today;
}

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    cardId: '',
    card: {},
    creator: { nickname: '', avatar: '', initial: '', relationText: '创立者' },
    helpers: [],
    keyPoints: [],
    statusClass: 'doing',
    statusText: '进行中',
    isOverdue: false,
    role: 'stranger',
    isCreator: false,
    isHelper: false,
    isNetworkView: false,
    canAcceptInvite: false,
    showApplySheet: false,
    applyMessage: '',
    pendingRequests: [],
    loading: false,
    safeAreaBottom: 0,
    cardReady: false,
    canEditStatus: false,
    swipeX: 0,
    swipeHintOpacity: 1,
    swiping: false,
    inviteDone: false
  },

  onLoad(options) {
    const sys = wx.getSystemInfoSync();
    const navInfo = getNavInfo();
    // iPhone Home 指示条安全区兜底：safeAreaInsets 缺失时用 safeArea 计算
    const safeBottom = sys.safeAreaInsets
      ? sys.safeAreaInsets.bottom
      : Math.max(0, sys.screenHeight - ((sys.safeArea && sys.safeArea.bottom) || sys.screenHeight));
    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight,
      safeAreaBottom: safeBottom
    });

    // 从「生成记事卡」跳转而来时，卡片下落动画伴随「卡叽」音效
    this.fromCreate = options.from === 'create';

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
      isOverdue: checkOverdue(data),
      role,
      isCreator,
      isHelper,
      isNetworkView,
      canAcceptInvite: role === 'stranger' && !isNetworkView,
      pendingRequests: data.pendingRequests || [],
      cardReady: true,
      canEditStatus: isCreator || isHelper
    }, () => {
      this.onCardRendered();
      this.ensureSwipeMetrics();
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
      isOverdue: checkOverdue(card),
      role: isCreator ? 'creator' : (isHelper ? 'helper' : 'stranger'),
      isCreator,
      isHelper,
      isNetworkView: false,
      canAcceptInvite: !isCreator && !isHelper,
      pendingRequests: [],
      cardReady: true,
      canEditStatus: isCreator || isHelper
    }, () => {
      this.onCardRendered();
      this.ensureSwipeMetrics();
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
    if (this.data.isHelper) return '一度人脉 · 共同行动人';
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

  // 点击状态胶囊，选择新状态（仅创立者 / 共同行动人）
  onStatusTap() {
    if (!this.data.canEditStatus) return;
    const labels = ['待确认', '进行中', '已完成'];
    const values = ['todo', 'doing', 'done'];
    wx.showActionSheet({
      itemList: labels,
      success: (res) => {
        const status = values[res.tapIndex];
        if (status) this.setCardStatus(status);
      }
    });
  },

  async setCardStatus(status) {
    const { cardId } = this.data;
    if (!cardId) return;

    try {
      const app = getApp();
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const res = await wx.cloud.callFunction({
          name: 'updateCard',
          data: { id: cardId, status }
        });

        if (res.result && res.result.code === 0) {
          wx.showToast({ title: '状态已更新', icon: 'success' });
          this.loadCard(cardId);
        } else {
          wx.showToast({ title: (res.result && res.result.message) || '操作失败', icon: 'none' });
        }
        return;
      }

      await store.updateCard(cardId, { status });
      wx.showToast({ title: '状态已更新', icon: 'success' });
      this.loadCard(cardId);
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 邀请 / 介绍给朋友
  inviteFriend() {
    wx.showShareMenu({ withShareTicket: true });
  },

  // ==================== 滑动邀请 ====================

  ensureSwipeMetrics() {
    if (this.swipeMaxX != null) return;
    const sys = wx.getSystemInfoSync();
    // 滑块 80rpx + 左右各 8rpx 内边距
    this.swipeKnobPx = 96 * (sys.windowWidth / 750);
    wx.createSelectorQuery()
      .in(this)
      .select('.swipe-invite')
      .boundingClientRect()
      .exec((res) => {
        const rect = res && res[0];
        if (rect && rect.width) {
          this.swipeMaxX = Math.max(0, rect.width - this.swipeKnobPx);
        }
      });
  },

  onSwipeStart(e) {
    if (this.data.inviteDone) return;
    this.ensureSwipeMetrics();
    this.swipeTouchX = e.touches[0].clientX;
    this.setData({ swiping: true });
  },

  onSwipeMove(e) {
    if (this.swipeTouchX == null || this.data.inviteDone) return;
    const max = this.swipeMaxX || 0;
    let x = e.touches[0].clientX - this.swipeTouchX;
    x = Math.max(0, max ? Math.min(x, max) : x);
    const progress = max ? x / max : 0;
    this.setData({
      swipeX: x,
      swipeHintOpacity: Math.max(0, 1 - progress * 1.4)
    });
  },

  onSwipeEnd() {
    if (this.swipeTouchX == null) return;
    this.swipeTouchX = null;
    this.setData({ swiping: false });

    const max = this.swipeMaxX || 0;
    const passed = max && this.data.swipeX >= max * 0.75;
    if (passed && !this.data.inviteDone) {
      // 滑到底：震动反馈并唤起分享
      this.setData({ swipeX: max, swipeHintOpacity: 1, inviteDone: true });
      try {
        wx.vibrateShort({ type: 'light' });
      } catch (e) {}
      setTimeout(() => {
        this.inviteFriend();
        wx.showToast({ title: '请点击右上角转发邀请', icon: 'none' });
      }, 300);
      setTimeout(() => {
        this.setData({ swipeX: 0, swipeHintOpacity: 1, inviteDone: false });
      }, 3000);
    } else {
      // 未过阈值：回弹
      this.setData({ swipeX: 0, swipeHintOpacity: 1 });
    }
  },

  // 卡片渲染完成：从「生成记事卡」进入时，卡片打出落地瞬间伴随「卡叽」音效
  onCardRendered() {
    if (!this.fromCreate) return;
    this.fromCreate = false;
    setTimeout(() => this.playDropSound(), 720);
  },

  playDropSound() {
    try {
      if (!this.dropAudio) {
        this.dropAudio = wx.createInnerAudioContext();
        this.dropAudio.src = '/assets/audio/invite-click.wav';
      }
      this.dropAudio.stop();
      this.dropAudio.play();
    } catch (e) {}
    try {
      wx.vibrateShort({ type: 'light' });
    } catch (e) {}
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
