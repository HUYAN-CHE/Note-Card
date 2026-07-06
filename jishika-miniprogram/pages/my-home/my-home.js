const { getCards } = require('../../utils/store');

const MOCK_USER = {
  nickname: 'Julian',
  intro: '品牌设计师，专注官网与视觉系统',
  avatar: '',
  initial: 'J'
};

const MOCK_SERVICE_TAGS = ['官网设计', '品牌梳理', '视觉系统'];

Page({
  data: {
    statusBarHeight: 44,
    heroPaddingTop: 64,
    user: MOCK_USER,
    serviceTags: MOCK_SERVICE_TAGS,
    activeTab: 'mine',
    cards: [],
    allCards: [],
    loading: false
  },

  onLoad() {
    this.updateSystemInfo();
    this.loadData();
  },

  updateSystemInfo() {
    try {
      const sys = wx.getSystemInfoSync();
      const menuButtonRect = wx.getMenuButtonBoundingClientRect();
      const screenWidth = sys.screenWidth || 375;
      const menuCenterPx = menuButtonRect.top + menuButtonRect.height / 2;
      const menuCenterRpx = menuCenterPx * (750 / screenWidth);
      const heroPaddingTop = Math.max(20, menuCenterRpx - 60);

      this.setData({
        statusBarHeight: sys.statusBarHeight || 44,
        heroPaddingTop
      });
    } catch (e) {
      this.setData({
        statusBarHeight: 44,
        heroPaddingTop: 64
      });
    }
  },

  async loadData() {
    this.setData({ loading: true });

    try {
      // TODO: 接入真实用户资料（users 集合 / getUserProfile 云函数）
      // TODO: 我协助的卡需要云函数支持，目前先按 creatorId 过滤
      const allCards = await getCards();
      this.setData({ allCards });
      this.filterCards();
    } catch (error) {
      this.setData({ cards: [] });
    } finally {
      this.setData({ loading: false });
    }
  },

  filterCards() {
    const { activeTab, allCards } = this.data;
    const openid = this.getCurrentOpenid();

    const cards = allCards.filter((card) => {
      if (activeTab === 'mine') {
        return card.creatorId === openid || (!card.creatorId && !openid);
      }
      return (card.helperIds || []).includes(openid);
    });

    this.setData({ cards });
  },

  getCurrentOpenid() {
    try {
      const app = getApp();
      return (app.globalData && app.globalData.openid) || '';
    } catch (error) {
      return '';
    }
  },

  switchTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    this.setData({ activeTab: tab }, () => {
      this.filterCards();
    });
  },

  openCard(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/card-detail/card-detail?id=${id}`
    });
  },

  onShareAppMessage() {
    return {
      title: '记事卡｜我的主页',
      path: '/pages/my-home/my-home'
    };
  }
});
