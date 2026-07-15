const { TYPE_LABELS, buildDraftFromContext } = require('../../services/ai-adapter');
const { getCard, createCardFromDraft, saveCard } = require('../../utils/store');
const { getNavInfo } = require('../../utils/ui');

const DEFAULT_FRIENDS = [
  { id: 'f1', nickname: '阿哲', status: '微信好友', selected: false },
  { id: 'f2', nickname: '小林', status: '已协作 3 次', selected: false },
  { id: 'f3', nickname: '王姐', status: '共同好友', selected: false },
  { id: 'f4', nickname: 'Anna', status: '微信好友', selected: false }
];

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    contentHeight: 500,
    card: {
      title: '',
      desc: '',
      keyPoints: [],
      status: 'draft',
      isNetworkVisible: true,
      helperIds: []
    },
    keyPointsText: '',
    helpers: [],
    showInviteSheet: false,
    friendCandidates: [],
    loadingFriends: false,
    safeAreaBottom: 0
  },

  onLoad(options = {}) {
    const sys = wx.getSystemInfoSync();
    const navInfo = getNavInfo();
    const footerHeightPx = 144 * sys.windowWidth / 750 + (sys.safeAreaInsets ? sys.safeAreaInsets.bottom : 0);
    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight,
      contentHeight: sys.windowHeight - navInfo.totalHeight - footerHeightPx,
      safeAreaBottom: sys.safeAreaInsets ? sys.safeAreaInsets.bottom : 0
    });
    this.loadCard(options);
    this.loadFriends();
  },

  async loadCard(options = {}) {
    const storedCard = options.id ? await getCard(options.id) : null;
    const pendingDraft = wx.getStorageSync('JISHIKA_PENDING_DRAFT');
    const blankDraft = buildDraftFromContext({ text: '', type: 'requirement', source: 'manual' });

    const card = storedCard || pendingDraft || blankDraft;
    this.setCard(card);
  },

  setCard(card) {
    const keyPoints = Array.isArray(card.keyPoints) ? card.keyPoints : [];
    const helperIds = Array.isArray(card.helperIds) ? card.helperIds : [];

    this.setData({
      card: {
        title: card.title || '',
        desc: card.desc || '',
        keyPoints,
        status: card.status || 'draft',
        isNetworkVisible: card.isNetworkVisible !== false,
        helperIds,
        id: card.id || '',
        type: card.type || 'requirement',
        typeLabel: card.typeLabel || TYPE_LABELS[card.type || 'requirement'],
        source: card.source || 'manual'
      },
      keyPointsText: keyPoints.join(' · '),
      helpers: helperIds.map((h) => this.normalizeHelper(h))
    });
  },

  async loadFriends() {
    this.setData({ loadingFriends: true });
    try {
      const app = getApp();
      const openid = app.globalData && app.globalData.openid;
      if (app.globalData && app.globalData.cloudReady && wx.cloud && openid) {
        const db = wx.cloud.database();
        const relRes = await db.collection('relationships')
          .where({ ownerId: openid, degree: 1 })
          .limit(50)
          .get();

        const relationships = relRes.data || [];
        if (relationships.length) {
          const friendOpenids = relationships.map((r) => r.to);
          const userRes = await db.collection('users')
            .where({ _openid: db.command.in(friendOpenids) })
            .limit(50)
            .get();

          const users = userRes.data || [];
          const friends = users.map((u) => ({
            id: u._openid,
            nickname: u.nickName || '未知用户',
            avatar: u.avatarUrl || '',
            status: '一度人脉',
            selected: false
          }));

          this.setData({ friendCandidates: friends });
          return;
        }
      }
      this.setData({ friendCandidates: DEFAULT_FRIENDS.map((f) => ({ ...f })) });
    } catch (e) {
      this.setData({ friendCandidates: DEFAULT_FRIENDS.map((f) => ({ ...f })) });
    } finally {
      this.setData({ loadingFriends: false });
    }
  },

  normalizeHelper(raw) {
    if (!raw) return { nickname: '未知', initial: '?', avatar: '' };
    if (typeof raw === 'string') {
      return { id: raw, nickname: raw, initial: this.getInitial(raw), avatar: '' };
    }
    return {
      id: raw.id || '',
      nickname: raw.nickname || raw.name || '未知',
      initial: this.getInitial(raw.nickname || raw.name),
      avatar: raw.avatar || ''
    };
  },

  getInitial(name) {
    if (!name) return '';
    return String(name).trim().charAt(0).toUpperCase();
  },

  onTitleInput(event) {
    this.setData({ 'card.title': event.detail.value });
  },

  onDescInput(event) {
    this.setData({ 'card.desc': event.detail.value });
  },

  onKeyPointsInput(event) {
    this.setData({ keyPointsText: event.detail.value });
  },

  toggleVisibility() {
    this.setData({ 'card.isNetworkVisible': !this.data.card.isNetworkVisible });
  },

  openInviteSheet() {
    this.setData({ showInviteSheet: true });
  },

  closeInviteSheet() {
    this.setData({ showInviteSheet: false });
  },

  toggleFriend(event) {
    const index = event.currentTarget.dataset.index;
    const list = [...this.data.friendCandidates];
    list[index].selected = !list[index].selected;
    this.setData({ friendCandidates: list });
  },

  noop() {},

  async sendInvite() {
    try {
      const saved = await this.persistCard({ status: 'todo' });
      this.closeInviteSheet();
      wx.showShareMenu({ withShareTicket: true });
      wx.showToast({ title: '请点击右上角转发', icon: 'none' });
      return saved;
    } catch (e) {
      // persistCard 已提示
    }
  },

  shareToGroup() {
    wx.showShareMenu({ withShareTicket: true });
    wx.showToast({ title: '请选择群聊转发', icon: 'none' });
  },

  goBack() {
    wx.navigateBack();
  },

  async saveDraft() {
    try {
      const saved = await this.persistCard({ status: 'draft' });
      wx.showToast({ title: '已存草稿', icon: 'success' });
      wx.navigateBack();
      return saved;
    } catch (e) {
      // persistCard 已提示
    }
  },

  async saveAndBack() {
    try {
      const saved = await this.persistCard({ status: 'todo' });
      wx.showToast({ title: '保存成功', icon: 'success' });
      wx.navigateBack();
      return saved;
    } catch (e) {
      // persistCard 已提示
    }
  },

  async persistCard(extra = {}) {
    if (!this.data.card.title.trim()) {
      wx.showToast({ title: '请输入标题', icon: 'none' });
      throw new Error('标题为空');
    }

    const keyPoints = this.data.keyPointsText
      .split('·')
      .map((item) => item.trim())
      .filter(Boolean);

    const selectedFriends = this.data.friendCandidates
      .filter((f) => f.selected)
      .map((f) => f.id || f.nickname);

    const helperIds = Array.from(new Set([
      ...this.data.card.helperIds,
      ...selectedFriends
    ]));

    const card = {
      ...this.data.card,
      ...extra,
      title: this.data.card.title.trim(),
      desc: this.data.card.desc || '',
      keyPoints,
      helperIds,
      isNetworkVisible: this.data.card.isNetworkVisible
    };

    const saved = card.id ? await saveCard(card) : await createCardFromDraft(card);
    wx.removeStorageSync('JISHIKA_PENDING_DRAFT');
    this.setCard(saved);
    return saved;
  },

  onShareAppMessage() {
    const card = this.data.card || {};
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
