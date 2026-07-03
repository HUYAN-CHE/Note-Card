Component({
  properties: {
    activeTab: {
      type: String,
      value: 'home'
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
