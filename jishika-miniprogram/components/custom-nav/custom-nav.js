Component({
  properties: {
    title: { type: String, value: '' },
    showBack: { type: Boolean, value: true },
    statusBarHeight: { type: Number, value: 44 },
    navHeight: { type: Number, value: 88 }
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
