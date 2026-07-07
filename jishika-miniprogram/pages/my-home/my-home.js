const app = getApp();
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
    allCards: [],
    cards: [],
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
      this.filterCards();
    } finally {
      this.setData({ loading: false });
    }
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
      filtered = allCards.filter(c =>
        Array.isArray(c.helperIds) && c.helperIds.includes(myId)
      );
      emptyText = '还没有协助过别人的记事卡';
    }
    this.setData({ cards: filtered, emptyText });
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
    const editForm = { ...this.data.editForm, avatar: avatarUrl };
    this.setData({ editForm });
  },

  onChooseNickname(e) {
    const nickname = e.detail.value;
    const editForm = { ...this.data.editForm, nickname, initial: this.getInitial(nickname) };
    this.setData({ editForm });
  },

  onIntroInput(e) {
    const intro = e.detail.value;
    this.setData({ editForm: { ...this.data.editForm, intro } });
  },

  toggleTagEdit() {
    this.setData({ tagEditing: !this.data.tagEditing });
  },

  onTagInput(e) {
    this.setData({ tagInput: e.detail.value });
  },

  addTag(e) {
    let value = (e.detail.value || this.data.tagInput || '').trim();
    if (!value) return;
    this.addTagCore(value);
  },

  addCandidateTag(e) {
    const value = e.currentTarget.dataset.tag;
    this.addTagCore(value);
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
          intro: '专注产品设计与用户增长，愿意帮你梳理需求、打磨方案。',
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
            customerName: '王女士',
            phone: '13800001234',
            creatorId: '林小北',
            helperIds: [],
            status: '进行中',
            progressNodes: [
              { id: 'n1', title: '需求确认', status: 'done' },
              { id: 'n2', title: '资料补充', status: 'current' },
              { id: 'n3', title: '阶段沟通', status: 'todo' },
              { id: 'n4', title: '服务完成', status: 'todo' }
            ],
            createdAt: now,
            updatedAt: now,
            updatedText: '07-02 19:00'
          },
          {
            id: 'card_demo_2',
            type: 'requirement',
            typeLabel: '方案卡',
            projectName: '小程序 MVP 方案',
            summary: '完成产品定位、核心流程与页面原型。',
            customerName: '李老板',
            creatorId: '林小北',
            helperIds: [],
            status: '已完成',
            progressNodes: [
              { id: 'n5', title: '需求访谈', status: 'done' },
              { id: 'n6', title: '方案输出', status: 'done' },
              { id: 'n7', title: '客户确认', status: 'done' }
            ],
            createdAt: now - 86400000,
            updatedAt: now - 86400000,
            updatedText: '07-01 15:00'
          },
          {
            id: 'card_demo_3',
            type: 'todo',
            typeLabel: '待办卡',
            projectName: '社群运营 SOP',
            summary: '帮朋友梳理社群拉新、激活与转化流程。',
            creatorId: '陈运营',
            helperIds: ['林小北'],
            status: '进行中',
            progressNodes: [
              { id: 'n8', title: '现状梳理', status: 'done' },
              { id: 'n9', title: 'SOP 初稿', status: 'current' },
              { id: 'n10', title: '试运行', status: 'todo' }
            ],
            createdAt: now - 172800000,
            updatedAt: now - 172800000,
            updatedText: '06-30 10:00'
          }
        ]);
      }
    } catch (e) {
      console.error('ensureMockData error', e);
    }
  }
});
