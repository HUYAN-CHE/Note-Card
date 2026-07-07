const store = require('../../utils/store.js');

const DEFAULT_CANDIDATE_TAGS = ['法律咨询', '财务规划', '职业规划', '心理咨询', '编程开发', '设计创意', '文案写作', '摄影摄像', '健身指导', '家庭教育', '房产顾问', '留学移民'];

const STATUS_MAP = {
  '进行中': { text: '进行中', class: 'doing' },
  '待确认': { text: '待确认', class: 'todo' },
  '待开始': { text: '待开始', class: 'todo' },
  '已完成': { text: '已完成', class: 'done' }
};

Page({
  data: {
    heroPaddingTop: 60,
    user: { nickname: '', avatar: '', initial: '我', intro: '' },
    serviceTags: [],
    candidateTags: [],
    tagInput: '',
    tagEditing: false,
    activeTab: 'mine',
    allCards: [],
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
    this.ensureMockData();
    await this.loadUserProfile();
    await this.loadStats();
  },

  onShow() {
    this.loadCards();
  },

  async loadUserProfile() {
    try {
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
      const candidateTags = DEFAULT_CANDIDATE_TAGS.filter(t => !serviceTags.includes(t));
      this.setData({ user, serviceTags, candidateTags, editForm: { ...user, serviceTags: [...serviceTags] } });
    } catch (e) {
      console.error('loadUserProfile error', e);
    }
  },

  async loadCards() {
    this.setData({ loading: true });
    try {
      const allCards = await store.getCards() || [];
      this.setData({ allCards });
      this.computeCounts();
      this.filterCards();
    } finally {
      this.setData({ loading: false });
    }
  },

  computeCounts() {
    const { allCards, user } = this.data;
    const myId = user.nickname || '我';
    const mineCards = allCards.filter(c => c.creatorId === myId || !c.creatorId);
    const mine = mineCards.filter(c => c.status !== '已完成' && c.stage !== '已完成').length;
    const done = mineCards.filter(c => c.status === '已完成' || c.stage === '已完成').length;
    const helped = allCards.filter(c => Array.isArray(c.helperIds) && c.helperIds.includes(myId)).length;
    this.setData({ counts: { mine, done, helped } });
  },

  filterCards() {
    const { activeTab, allCards, user } = this.data;
    const myId = user.nickname || '我';
    let filtered = [];
    let emptyText = '还没有记事卡';
    if (activeTab === 'mine') {
      filtered = allCards.filter(c => c.creatorId === myId || !c.creatorId);
      filtered = filtered.filter(c => c.status !== '已完成' && c.stage !== '已完成');
      emptyText = '还没有未完成的记事卡';
    } else if (activeTab === 'done') {
      filtered = allCards.filter(c => c.creatorId === myId || !c.creatorId);
      filtered = filtered.filter(c => c.status === '已完成' || c.stage === '已完成');
      emptyText = '还没有已完成的记事卡';
    } else if (activeTab === 'helped') {
      filtered = allCards.filter(c => Array.isArray(c.helperIds) && c.helperIds.includes(myId));
      emptyText = '还没有协助过别人的记事卡';
    }
    this.setData({ cards: filtered.map(c => this.decorateCard(c)) , emptyText });
  },

  decorateCard(card) {
    const status = card.status || card.stage || '进行中';
    const mapped = STATUS_MAP[status] || { text: status, class: 'doing' };
    return {
      ...card,
      statusText: mapped.text,
      statusClass: mapped.class,
      whenText: card.updatedText || this.formatWhen(card.updatedAt)
    };
  },

  formatWhen(ts) {
    if (!ts) return '';
    const now = Date.now();
    const diff = now - ts;
    if (diff < 3600000) return '刚刚';
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 172800000) return '昨天';
    const d = new Date(ts);
    return `${d.getMonth() + 1}-${d.getDate()}`;
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab }, () => this.filterCards());
  },

  async loadStats() {
    const cached = wx.getStorageSync('my_profile');
    const profile = (cached && typeof cached === 'object') ? cached : {};
    const helperIds = Array.isArray(profile.helperIds) ? profile.helperIds : [];
    const helperCount = helperIds.length || profile.helperCount || 0;
    const allCards = await store.getCards() || [];
    const myId = this.data.user.nickname || '我';
    const helpedCount = allCards.filter(c => c.creatorId === myId).length || profile.helpedCount || 0;
    this.setData({ stats: { helperCount, helpedCount } });
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

  saveProfile() {
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
    const candidateTags = DEFAULT_CANDIDATE_TAGS.filter(t => !serviceTags.includes(t));
    this.setData({
      user,
      serviceTags: [...serviceTags],
      candidateTags,
      isEditing: false,
      tagEditing: false,
      tagInput: ''
    });
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
    const candidateTags = DEFAULT_CANDIDATE_TAGS.filter(t => !next.includes(t));
    this.setData({ serviceTags: next, candidateTags, tagInput: '' });
  },

  removeTag(e) {
    const index = e.currentTarget.dataset.index;
    const next = [...this.data.serviceTags];
    next.splice(index, 1);
    const candidateTags = DEFAULT_CANDIDATE_TAGS.filter(t => !next.includes(t));
    this.setData({ serviceTags: next, candidateTags });
  },

  openCard(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/card-detail/card-detail?id=${id}&view=owner` });
  },

  getInitial(name) {
    if (!name) return '我';
    return name.trim().charAt(0).toUpperCase() || '我';
  },

  ensureMockData() {
    try {
      const hasProfile = wx.getStorageSync('my_profile');
      if (!hasProfile) {
        wx.setStorageSync('my_profile', {
          nickname: '林小北',
          avatar: '',
          intro: '帮朋友把想法落地 ✨',
          serviceTags: ['产品设计', '用户增长', '需求梳理'],
          helperIds: ['张律师', '王财税'],
          helpedCount: 0,
          updatedAt: Date.now()
        });
      }

      const cards = wx.getStorageSync('JISHIKA_CARDS') || [];
      if (!cards.length) {
        const now = Date.now();
        wx.setStorageSync('JISHIKA_CARDS', [
          {
            id: 'card_demo_1',
            type: 'requirement',
            typeLabel: '需求确认卡',
            projectName: '企业官网改版',
            summary: '客户希望重做企业官网，重点关注移动端适配和品牌感。',
            keyPoints: ['移动端适配', '提升品牌感', '希望 6 月底前上线'],
            customerName: '王女士',
            phone: '13800001234',
            creatorId: '林小北',
            helperIds: [],
            status: '进行中',
            createdAt: now,
            updatedAt: now,
            updatedText: '刚刚'
          },
          {
            id: 'card_demo_2',
            type: 'requirement',
            typeLabel: '方案卡',
            projectName: '小程序 MVP 方案',
            summary: '完成产品定位、核心流程与页面原型。',
            keyPoints: ['预算 8k', '2 周交付'],
            customerName: '李老板',
            creatorId: '林小北',
            helperIds: [],
            status: '已完成',
            createdAt: now - 86400000,
            updatedAt: now - 86400000,
            updatedText: '昨天'
          },
          {
            id: 'card_demo_3',
            type: 'todo',
            typeLabel: '待办卡',
            projectName: '社群运营 SOP',
            summary: '帮朋友梳理社群拉新、激活与转化流程。',
            keyPoints: ['拉新渠道', '激活话术', '转化路径'],
            creatorId: '陈运营',
            helperIds: ['林小北'],
            status: '进行中',
            createdAt: now - 172800000,
            updatedAt: now - 172800000,
            updatedText: '前天'
          }
        ]);
      }
    } catch (e) {
      console.error('ensureMockData error', e);
    }
  }
});
