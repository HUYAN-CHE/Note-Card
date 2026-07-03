Page({
  data: {
    card: null
  },

  onLoad(options) {
    // TODO: 根据 id 加载记事卡详情
    console.log('card-detail id:', options.id);
  },

  onApplyJoin() {
    // TODO: 申请加入流程
    wx.showToast({
      title: '申请加入开发中',
      icon: 'none'
    });
  }
});
