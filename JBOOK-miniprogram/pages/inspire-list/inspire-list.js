const { getNavInfo } = require('../../utils/ui');
const { listInspireCards, splitInspireColumns } = require('../../services/inspire-cards');

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    // 状态筛选：collecting 集灵中 / exported 已输出
    statusTab: 'collecting',
    allCards: [],
    cards: [],
    cols: { left: [], right: [] },
    collectingCount: 0,
    exportedCount: 0
  },

  onLoad() {
    const navInfo = getNavInfo();
    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight
    });
  },

  onShow() {
    this.loadCards();
  },

  loadCards() {
    listInspireCards(true)
      .then((cards) => {
        this.setData({
          allCards: cards,
          collectingCount: cards.filter((c) => c.status === 'collecting').length,
          exportedCount: cards.filter((c) => c.status === 'exported').length
        });
        this.applyFilter();
      })
      .catch((e) => console.warn('loadCards error', e));
  },

  onStatusTabTap(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab && tab !== this.data.statusTab) {
      this.setData({ statusTab: tab });
      this.applyFilter();
    }
  },

  applyFilter() {
    const { allCards, statusTab } = this.data;
    const cards = allCards.filter((c) => c.status === statusTab);
    this.setData({ cards, cols: splitInspireColumns(cards) });
  },

  // 点击灵感卡，进入可编辑的文章页（带上列表着色，保持视觉连续）
  openInspireDetail(e) {
    const { id, color } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: `/pages/inspire-detail/inspire-detail?id=${id}&color=${encodeURIComponent(color || '')}` });
  }
});
