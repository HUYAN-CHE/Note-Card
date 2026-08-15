const { getSafeAreaBottom } = require('../../utils/ui');

Component({
  properties: {
    activeTab: {
      type: String,
      value: 'home'
    }
  },

  data: {
    // 底部安全区（px）：安卓 env(safe-area-inset-bottom) 多数机型为 0，改 JS 计算统一兜底
    safeBottom: 12
  },

  lifetimes: {
    attached() {
      this.setData({ safeBottom: getSafeAreaBottom() });
    }
  },

  methods: {
    switchTab(event) {
      const tab = event.currentTarget.dataset.tab;
      if (tab === this.data.activeTab) return;

      if (tab === 'home') {
        wx.redirectTo({
          url: '/pages/home/home'
        });
      } else if (tab === 'mutual-help') {
        wx.redirectTo({
          url: '/pages/mutual-help/mutual-help'
        });
      }
    }
  }
});
