const MOCK_HELPERS = [
  { id: 'add', type: 'add', name: '添加', avatar: '' },
  { id: 'u1', type: 'user', name: '李群', avatar: '' },
  { id: 'u2', type: 'user', name: '王珏什', avatar: '' },
  { id: 'u3', type: 'user', name: '米娅林', avatar: '' },
  { id: 'u4', type: 'user', name: '何诗怡', avatar: '' }
];

const MOCK_CARDS = [
  {
    id: 'c1',
    title: 'I\'m Feeling Lucky',
    desc: 'Not sure who to talk to? Try someone random',
    creatorName: '李群的朋友',
    status: '进行中'
  },
  {
    id: 'c2',
    title: 'I\'m Feeling Lucky',
    desc: 'Not sure who to talk to? Try someone random',
    creatorName: '王珏什的朋友',
    status: '待确认'
  },
  {
    id: 'c3',
    title: 'I\'m Feeling Lucky',
    desc: 'Not sure who to talk to? Try someone random',
    creatorName: '米娅林的朋友',
    status: '进行中'
  }
];

Page({
  data: {
    statusBarHeight: 44,
    heroPaddingTop: 64,
    selectedHelperId: '',
    helpers: MOCK_HELPERS,
    cards: MOCK_CARDS,
    hintText: '你的朋友也可能看到，方便大家一起帮忙'
  },

  onLoad() {
    this.updateSystemInfo();
    const firstUser = this.data.helpers.find((h) => h.type === 'user');
    if (firstUser) {
      this.setData({ selectedHelperId: firstUser.id });
    }
  },

  onShow() {
    // 后续接入真实数据
  },

  updateSystemInfo() {
    try {
      const sys = wx.getSystemInfoSync();
      const menuButtonRect = wx.getMenuButtonBoundingClientRect();
      const screenWidth = sys.screenWidth || 375;
      const menuCenterPx = menuButtonRect.top + menuButtonRect.height / 2;
      const menuCenterRpx = menuCenterPx * (750 / screenWidth);
      const avatarCenterOffsetRpx = 32; // 头像区域 64rpx，中心在 32rpx
      const heroPaddingTop = Math.max(20, menuCenterRpx - avatarCenterOffsetRpx);

      this.setData({
        statusBarHeight: sys.statusBarHeight || 44,
        heroPaddingTop
      });
    } catch (e) {
      // 使用默认值
      this.setData({
        statusBarHeight: 44,
        heroPaddingTop: 64
      });
    }
  },

  onHelperTap(event) {
    const id = event.currentTarget.dataset.id;
    if (id === 'add') {
      this.onInviteTap();
      return;
    }
    this.setData({ selectedHelperId: id });
    // TODO: 刷新列表
    this.refreshCards(id);
  },

  refreshCards(helperId) {
    // 静态阶段仅切换选中状态，后续接入 getNetworkCards
    console.log('refreshCards for helper:', helperId);
  },

  onInviteTap() {
    // TODO: 邀请朋友使用小程序或协作记事卡
    wx.showToast({
      title: '邀请功能开发中',
      icon: 'none'
    });
  },

  onMyProfileTap() {
    wx.navigateTo({
      url: '/pages/my-home/my-home'
    });
  },

  onCardTap(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/card-detail/card-detail?id=${id}`
    });
  },

  onShareAppMessage() {
    return {
      title: '记事卡｜一起协作，互相帮忙',
      path: '/pages/mutual-help/mutual-help'
    };
  }
});
