const store = require('../../utils/store.js');

const DEFAULT_CANDIDATE_TAGS = ['法律咨询', '财务规划', '职业规划', '心理咨询', '编程开发', '设计创意', '文案写作', '摄影摄像', '健身指导', '家庭教育', '房产顾问', '留学移民'];

Page({
  data: {
    heroPaddingTop: 60,
    user: { nickname: '', avatar: '', initial: '我', intro: '' },
    serviceTags: [],
    candidateTags: [],
    tagInput: '',
    tagEditing: false,
    activeTab: 'mine',
    cards: [],
    counts: { mine: 0, done: 0, helped: 0 },
    isEditing: false,
    editForm: {},
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
      // 本地兜底
      await this.loadLocalData();
    } catch (e) {
      await this.loadLocalData();
    } finally {
      this.setData({ loading: false });
    }
  },

  renderData(data) {
    const profile = data.profile || {};
    const serviceTags = Array.isArray(profile.serviceTags) ? profile.serviceTags : [];
    const candidateTags = (data.candidateTags || DEFAULT_CANDIDATE_TAGS)
      .filter((t) => !serviceTags.includes(t));

    this.setData({
      user: {
        nickname: profile.nickname || '',
        avatar: profile.avatar || '',
        initial: profile.initial || '我',
        intro: profile.intro || ''
      },
      serviceTags,
      candidateTags,
      editForm: {
        nickname: profile.nickname || '',
        avatar: profile.avatar || '',
        intro: profile.intro || ''
      },
      allCards: data.allCards || [],
      counts: data.counts || { mine: 0, done: 0, helped: 0 },
      stats: data.stats || { helperCount: 0, helpedCount: 0 }
    }, () => {
      this.filterCards();
    });
  },

  async loadLocalData() {
    const cached = wx.getStorageSync('my_profile');
    const fallback = { nickname: '', avatar: '', intro: '', serviceTags: [] };
    const profile = (cached && typeof cached === 'object') ? cached : fallback;
    const user = {
      nickname: profile.nickname || '',
      avatar: profile.avatar || '',
      initial: this.getInitial(profile.nickname),
      intro: profile.intro || ''
    };
    const serviceTags = Array.isArray(profile.serviceTags) ? profile.serviceTags : [];
    const candidateTags = DEFAULT_CANDIDATE_TAGS.filter((t) => !serviceTags.includes(t));

    const allCards = await store.getCards() || [];
    const myId = user.nickname || store.getCurrentOpenid() || '我';
    const mineCards = allCards.filter((c) => c.creatorId === myId || !c.creatorId);
    const helpedCards = allCards.filter((c) => Array.isArray(c.helperIds) && c.helperIds.includes(myId));

    this.setData({
      user,
      serviceTags,
      candidateTags,
      editForm: { ...user, serviceTags: [...serviceTags] },
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

  filterCards() {
    const { activeTab, allCards = [], user } = this.data;
    const myId = user.nickname || store.getCurrentOpenid() || '我';
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

  startEdit() {
    this.setData({
      isEditing: true,
      editForm: { ...this.data.user, serviceTags: [...this.data.serviceTags] }
    });
  },

  cancelEdit() {
    this.setData({ isEditing: false, tagEditing: false, tagInput: '' });
  },

  async saveProfile() {
    const { editForm, serviceTags } = this.data;
    const user = {
      nickname: editForm.nickname || this.data.user.nickname || '我',
      avatar: editForm.avatar || this.data.user.avatar || '',
      initial: this.getInitial(editForm.nickname || this.data.user.nickname),
      intro: editForm.intro || ''
    };
    const profile = {
      ...user,
      serviceTags: [...serviceTags],
      updatedAt: Date.now()
    };

    wx.setStorageSync('my_profile', profile);
    const candidateTags = DEFAULT_CANDIDATE_TAGS.filter((t) => !serviceTags.includes(t));

    this.setData({
      user,
      serviceTags: [...serviceTags],
      candidateTags,
      isEditing: false,
      tagEditing: false,
      tagInput: ''
    });

    await store.saveUserProfile(profile);
    wx.showToast({ title: '保存成功', icon: 'success' });
  },

  onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl;
    this.setData({ editForm: { ...this.data.editForm, avatar: avatarUrl } });
  },

  onChooseNickname(e) {
    const nickname = e.detail.value;
    this.setData({ editForm: { ...this.data.editForm, nickname, initial: this.getInitial(nickname) } });
  },

  onIntroInput(e) {
    this.setData({ editForm: { ...this.data.editForm, intro: e.detail.value } });
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
    if (!name) return '我';
    return name.trim().charAt(0).toUpperCase() || '我';
  }
});
