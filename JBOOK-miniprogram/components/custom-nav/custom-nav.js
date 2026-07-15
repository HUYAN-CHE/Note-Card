const { getNavInfo } = require('../../utils/ui.js');

Component({
  properties: {
    title: { type: String, value: '' },
    showBack: { type: Boolean, value: true }
  },

  data: {
    statusBarHeight: 44,
    navHeight: 88
  },

  lifetimes: {
    attached() {
      const { statusBarHeight, navHeight } = getNavInfo();
      this.setData({ statusBarHeight, navHeight });
    }
  },

  methods: {
    goBack() {
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack({ delta: 1 });
      } else {
        wx.switchTab({ url: '/pages/home/home' });
      }
    }
  }
});
