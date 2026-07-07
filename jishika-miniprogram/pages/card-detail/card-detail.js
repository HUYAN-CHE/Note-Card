const store = require('../../utils/store.js');

const STATUS_TEXT = {
  done: '已完成',
  current: '进行中',
  todo: '待开始'
};

Page({
  data: {
    cardId: '',
    view: 'network',
    card: {},
    creator: { nickname: '', avatar: '', initial: '?' },
    helpers: [],
    progressPercent: 0,
    milestones: [],
    applied: false,
    isCreator: false,
    loading: false
  },

  onLoad(options) {
    const cardId = options.id || '';
    const view = options.view || 'network';
    this.setData({ cardId, view });
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
      const helpers = (card.helperIds || card.helpers || []).map(h => this.normalizeUser(h));
      const milestones = this.buildMilestones(card);
      const progressPercent = this.calcProgress(milestones);
      const isCreator = this.isCurrentUser(creator.id || creator.nickname);
      this.setData({
        card,
        creator,
        helpers,
        milestones,
        progressPercent,
        isCreator
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

  isCurrentUser(value) {
    if (!value) return false;
    const myProfile = wx.getStorageSync('my_profile') || {};
    const myName = myProfile.nickname || '';
    const openid = (getApp().globalData && getApp().globalData.openid) || wx.getStorageSync('JISHIKA_OPENID') || '';
    return value === myName || value === openid;
  },

  getInitial(name) {
    if (!name) return '?';
    return String(name).trim().charAt(0).toUpperCase() || '?';
  },

  buildMilestones(card) {
    const nodes = card.progressNodes || card.milestones || [];
    if (nodes.length) {
      return nodes.map(n => ({
        id: n.id || String(Math.random()),
        title: n.title,
        status: n.status || 'todo',
        statusText: STATUS_TEXT[n.status] || STATUS_TEXT.todo
      }));
    }
    // 兜底：按 stage/status 生成简单节点
    const fallback = [];
    if (card.stage || card.status) {
      fallback.push({ id: '1', title: card.stage || card.status, status: 'current', statusText: STATUS_TEXT.current });
    }
    if (card.nextStep) {
      fallback.push({ id: '2', title: card.nextStep, status: 'todo', statusText: STATUS_TEXT.todo });
    }
    return fallback;
  },

  calcProgress(milestones) {
    if (!milestones.length) return 0;
    const done = milestones.filter(m => m.status === 'done').length;
    return Math.round((done / milestones.length) * 100);
  },

  onApplyJoin() {
    if (this.data.applied) return;
    wx.showModal({
      title: '申请加入',
      content: '向创立者发送协助申请？',
      confirmColor: '#00c853',
      success: (res) => {
        if (res.confirm) {
          this.setData({ applied: true });
          wx.showToast({ title: '申请已发送', icon: 'success' });
        }
      }
    });
  }
});
