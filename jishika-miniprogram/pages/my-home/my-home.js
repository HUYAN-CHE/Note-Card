const store = require('../../utils/store.js');

const DEFAULT_CANDIDATE_TAGS = ['法律咨询', '财务规划', '职业规划', '心理咨询', '编程开发', '设计创意', '文案写作', '摄影摄像', '健身指导', '家庭教育', '房产顾问', '留学移民'];
const REMARK_KEY = 'JISHIKA_MY_REMARK';
const AUTH_PROFILE_KEY = 'JISHIKA_USER_PROFILE';

Page({
  data: {
    heroPaddingTop: 60,
    user: { nickname: '', avatar: '', initial: '' },
    remark: '',
    serviceTags: [],
    candidateTags: [],
    tagInput: '',
    tagEditing: false,
    activeTab: 'mine',
    cards: [],
    counts: { mine: 0, done: 0, helped: 0 },
    isEditingRemark: false,
    editRemark: '',
    loading: false,
    emptyText: '还没有记事卡',
    stats: { helperCount: 0, helpedCount: 0 }
  },

  async onLoad() {
    const sys = wx.getSystemInfoSync();
    const heroPaddingTop = (sys.statusBarHeight || 20) + 12;
    this.setData({ heroPaddingTop });
    await this.loadData();
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      const app = getApp();
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const res = await wx.cloud.callFunction({ name: 'getMyHomeData' });
        if (res.result && res.result.code === 0) {
          this.renderData(res.result.data);
          return;
        }
      }
      await this.loadLocalData();
    } catch (e) {
      await this.loadLocalData();
    } finally {
      this.setData({ loading: false });
    }
  },

  renderData(data) {
    const cloudProfile = data.profile || {};
    const authProfile = this.loadAuthProfile();

    // 云端为空时，用本地授权信息兜底
    const profile = {
      nickname: cloudProfile.nickname || authProfile.nickname || '',
      avatar: cloudProfile.avatar || authProfile.avatar || '',
      initial: cloudProfile.initial || authProfile.initial || ''
    };

    const serviceTags = Array.isArray(cloudProfile.serviceTags)
      ? cloudProfile.serviceTags
      : (Array.isArray(authProfile.serviceTags) ? authProfile.serviceTags : []);

    const candidateTags = (data.candidateTags || DEFAULT_CANDIDATE_TAGS)
      .filter((t) => !serviceTags.includes(t));

    const remark = this.loadRemark();

    this.setData({
      user: profile,
      remark,
      serviceTags,
      candidateTags,
      allCards: data.allCards || [],
      counts: data.counts || { mine: 0, done: 0, helped: 0 },
      stats: data.stats || { helperCount: 0, helpedCount: 0 }
    }, () => {
      this.filterCards();
    });
  },

  async loadLocalData() {
    const profile = this.loadAuthProfile();
    const remark = this.loadRemark();
    const serviceTags = Array.isArray(profile.serviceTags) ? profile.serviceTags : [];
    const candidateTags = DEFAULT_CANDIDATE_TAGS.filter((t) => !serviceTags.includes(t));

    const allCards = await store.getCards() || [];
    const myId = profile.nickname || store.getCurrentOpenid() || '';
    const mineCards = allCards.filter((c) => c.creatorId === myId || !c.creatorId);
    const helpedCards = allCards.filter((c) => Array.isArray(c.helperIds) && c.helperIds.includes(myId));

    this.setData({
      user: {
        nickname: profile.nickname || '',
        avatar: profile.avatar || '',
        initial: profile.initial || ''
      },
      remark,
      serviceTags,
      candidateTags,
      allCards,
      counts: {
        mine: mineCards.filter((c) => c.status !== 'done').length,
        done: mineCards.filter((c) => c.status === 'done').length,
        helped: helpedCards.length
      },
      stats: {
        helperCount: 0,
        helpedCount: mineCards.filter((c) => Array.isArray(c.helperIds) && c.helperIds.length > 0).length
      }
    }, () => {
      this.filterCards();
    });
  },

  loadAuthProfile() {
    const app = getApp();
    const globalProfile = app.globalData && app.globalData.userProfile;
    const localProfile = wx.getStorageSync(AUTH_PROFILE_KEY);
    const cached = globalProfile || localProfile;
    const fallback = { nickname: '', avatar: '', serviceTags: [] };
    const profile = (cached && typeof cached === 'object') ? cached : fallback;
    return {
      nickname: profile.nickname || '',
      avatar: profile.avatar || '',
      initial: profile.initial || this.getInitial(profile.nickname),
      serviceTags: Array.isArray(profile.serviceTags) ? profile.serviceTags : []
    };
  },

  loadRemark() {
    return wx.getStorageSync(REMARK_KEY) || '';
  },

  filterCards() {
    const { activeTab, allCards = [], user } = this.data;
    const myId = user.nickname || store.getCurrentOpenid() || '';
    let filtered = [];
    let emptyText = '还没有记事卡';

    if (activeTab === 'mine') {
      filtered = allCards.filter((c) => c.creatorId === myId || !c.creatorId);
      filtered = filtered.filter((c) => c.status !== 'done');
      emptyText = '还没有未完成的记事卡';
    } else if (activeTab === 'done') {
      filtered = allCards.filter((c) => c.creatorId === myId || !c.creatorId);
      filtered = filtered.filter((c) => c.status === 'done');
      emptyText = '还没有已完成的记事卡';
    } else if (activeTab === 'helped') {
      filtered = allCards.filter((c) => Array.isArray(c.helperIds) && c.helperIds.includes(myId));
      emptyText = '还没有协助过别人的记事卡';
    }

    this.setData({ cards: filtered, emptyText });
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab }, () => this.filterCards());
  },

  startEditRemark() {
    this.setData({
      isEditingRemark: true,
      editRemark: this.data.remark
    });
  },

  cancelEditRemark() {
    this.setData({ isEditingRemark: false, editRemark: '' });
  },

  onRemarkInput(e) {
    this.setData({ editRemark: e.detail.value });
  },

  saveRemark() {
    const remark = this.data.editRemark.trim();
    wx.setStorageSync(REMARK_KEY, remark);
    this.setData({ remark, isEditingRemark: false, editRemark: '' });
    wx.showToast({ title: '备注已保存', icon: 'success' });
  },

  toggleTagEdit() {
    this.setData({ tagEditing: !this.data.tagEditing });
  },

  onTagInput(e) {
    this.setData({ tagInput: e.detail.value });
  },

  addTag(e) {
    const value = (e.detail.value || this.data.tagInput || '').trim();
    if (!value) return;
    this.addTagCore(value);
  },

  addCandidateTag(e) {
    this.addTagCore(e.currentTarget.dataset.tag);
  },

  addTagCore(value) {
    const { serviceTags } = this.data;
    if (serviceTags.includes(value)) {
      wx.showToast({ title: '标签已存在', icon: 'none' });
      return;
    }
    if (serviceTags.length >= 8) {
      wx.showToast({ title: '最多 8 个标签', icon: 'none' });
      return;
    }
    const next = [...serviceTags, value];
    const candidateTags = DEFAULT_CANDIDATE_TAGS.filter((t) => !next.includes(t));
    this.setData({ serviceTags: next, candidateTags, tagInput: '' });
  },

  removeTag(e) {
    const index = e.currentTarget.dataset.index;
    const next = [...this.data.serviceTags];
    next.splice(index, 1);
    const candidateTags = DEFAULT_CANDIDATE_TAGS.filter((t) => !next.includes(t));
    this.setData({ serviceTags: next, candidateTags });
  },

  openCard(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/card-detail/card-detail?id=${id}&view=owner` });
  },

  getInitial(name) {
    if (!name) return '';
    return name.trim().charAt(0).toUpperCase();
  }
});
