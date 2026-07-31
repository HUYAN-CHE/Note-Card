const { getNavInfo } = require('../../utils/ui');
const { INSPIRE_CARDS } = require('../../services/inspire-cards');

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    // 灵感卡（占位数据，与首页/我的主页同源）
    cards: INSPIRE_CARDS
  },

  onLoad() {
    const navInfo = getNavInfo();
    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight
    });
  }
});
