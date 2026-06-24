Page({
  onPullCreate() {
    wx.navigateTo({
      url: '/pages/intake/intake?source=pull_create&type=requirement'
    });
  },

  openLatestCard() {
    wx.navigateTo({
      url: '/pages/card-edit/card-edit'
    });
  }
});
