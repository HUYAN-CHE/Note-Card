const { TYPE_LABELS, buildDraftFromContext } = require('../../services/ai-adapter');
const { getCard, createCardFromDraft, saveCard } = require('../../utils/store');

const MOCK_FRIENDS = [
  { id: 'f1', nickname: '阿哲', status: '微信好友', selected: false },
  { id: 'f2', nickname: '小林', status: '已协作 3 次', selected: false },
  { id: 'f3', nickname: '王姐', status: '共同好友', selected: false },
  { id: 'f4', nickname: 'Anna', status: '微信好友', selected: false }
];

Page({
  data: {
    statusBarHeight: 44,
    card: {},
    keyPointsText: '',
    helpers: [],
    isNetworkVisible: true,
    showInviteSheet: false,
    friendCandidates: []
  },

  onLoad(options = {}) {
    const sys = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: (sys.statusBarHeight || 20) });
    this.loadCard(options);
  },

  async loadCard(options = {}) {
    const storedCard = options.id ? await getCard(options.id) : null;
    const pendingDraft = wx.getStorageSync('JISHIKA_PENDING_DRAFT');
    const blankDraft = buildDraftFromContext({
      text: '',
      type: 'requirement',
      source: 'manual'
    });
    const card = storedCard || pendingDraft || blankDraft;
    this.setCard(card);
  },

  setCard(card) {
    const keyPoints = Array.isArray(card.keyPoints) ? card.keyPoints : [];
    const helperIds = Array.isArray(card.helperIds) ? card.helperIds : [];
    this.setData({
      card: {
        ...card,
        type: card.type || 'requirement',
        typeLabel: card.typeLabel || TYPE_LABELS[card.type || 'requirement'],
        isNetworkVisible: card.isNetworkVisible !== false
      },
      keyPointsText: keyPoints.join(' · '),
      helpers: helperIds.map(h => this.normalizeHelper(h)),
      friendCandidates: MOCK_FRIENDS.map(f => ({ ...f }))
    });
  },

  normalizeHelper(raw) {
    if (!raw) return { nickname: '未知', initial: '?', avatar: '' };
    if (typeof raw === 'string') {
      return { nickname: raw, initial: this.getInitial(raw), avatar: '' };
    }
    return {
      id: raw.id || '',
      nickname: raw.nickname || raw.name || '未知',
      initial: this.getInitial(raw.nickname || raw.name),
      avatar: raw.avatar || ''
    };
  },

  getInitial(name) {
    if (!name) return '?';
    return String(name).trim().charAt(0).toUpperCase() || '?';
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`card.${field}`]: event.detail.value });
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
    const saved = await this.persistCard({ status: 'pending_confirm' });
    this.closeInviteSheet();
    wx.showShareMenu({ withShareTicket: true });
    wx.showToast({ title: '请点击右上角转发', icon: 'none' });
    return saved;
  },

  goBack() {
    wx.navigateBack();
  },

  async saveDraft() {
    const saved = await this.persistCard({ status: 'draft' });
    wx.showToast({ title: '已存草稿', icon: 'success' });
    wx.navigateBack();
    return saved;
  },

  async saveAndBack() {
    const saved = await this.persistCard({ status: 'pending_confirm' });
    wx.showToast({ title: '保存成功', icon: 'success' });
    wx.navigateBack();
    return saved;
  },

  async persistCard(extra = {}) {
    const keyPoints = this.data.keyPointsText
      .split('·')
      .map(item => item.trim())
      .filter(Boolean);

    const selectedFriends = this.data.friendCandidates
      .filter(f => f.selected)
      .map(f => f.nickname);

    const helperIds = [
      ...new Set([
        ...(this.data.helpers.map(h => h.nickname)),
        ...selectedFriends
      ])
    ];

    const card = {
      ...this.data.card,
      ...extra,
      projectName: this.data.card.projectName || '未命名事项',
      summary: this.data.card.summary || '',
      keyPoints,
      helperIds,
      visibility: this.data.card.isNetworkVisible ? 'network' : 'friends'
    };

    const saved = card.id ? await saveCard(card) : await createCardFromDraft(card);
    wx.removeStorageSync('JISHIKA_PENDING_DRAFT');
    this.setCard(saved);
    return saved;
  },

  onShareAppMessage() {
    const card = this.data.card || {};
    const title = card.projectName
      ? `邀请你一起用《${card.projectName}》`
      : '邀请你一起用记事卡';
    return {
      title,
      path: card.id ? `/pages/card-detail/card-detail?id=${card.id}` : '/pages/home/home',
      imageUrl: '/assets/logo.png'
    };
  }
});
