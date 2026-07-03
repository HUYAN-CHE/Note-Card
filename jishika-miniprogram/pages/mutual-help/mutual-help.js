const MOCK_HELPERS = [
  { id: 'add', type: 'add', name: '添加', avatar: '' },
  { id: 'u1', type: 'user', name: '李群', avatar: '' },
  { id: 'u2', type: 'user', name: '王珏什', avatar: '' },
  { id: 'u3', type: 'user', name: '米娅林', avatar: '' },
  { id: 'u4', type: 'user', name: '何诗怡', avatar: '' }
];

// 每个一度人脉对应其朋友（二度人脉）的记事卡
const MOCK_NETWORK_CARDS = {
  u1: [
    { id: 'c1', title: '企业官网改版', desc: '需要移动端适配，希望6月底前上线', creatorName: '张明', relation: '李群的朋友', status: '需求确认' },
    { id: 'c2', title: '品牌物料设计', desc: '活动海报和易拉宝，下周活动用', creatorName: '刘洋', relation: '李群的朋友', status: '服务进度' },
    { id: 'c3', title: '小程序需求沟通', desc: '客户跟进小程序，方便确认进度', creatorName: '陈静', relation: '李群的朋友', status: '预约沟通' },
    { id: 'c4', title: '公众号内容规划', desc: '三个月内容排期，偏行业干货', creatorName: '赵磊', relation: '李群的朋友', status: '需求确认' },
    { id: 'c5', title: '产品摄影需求', desc: '新品白底图和场景图，共30张', creatorName: '孙婷', relation: '李群的朋友', status: '服务进度' }
  ],
  u2: [
    { id: 'c6', title: '线下活动策划', desc: '季度客户沙龙，需要场地和物料', creatorName: '周强', relation: '王珏什的朋友', status: '预约沟通' },
    { id: 'c7', title: 'VI 视觉升级', desc: '品牌视觉整体升级，Logo配色调整', creatorName: '吴芳', relation: '王珏什的朋友', status: '需求确认' },
    { id: 'c8', title: '短视频脚本', desc: '10条产品种草脚本，偏轻科普', creatorName: '郑伟', relation: '王珏什的朋友', status: '服务进度' },
    { id: 'c9', title: '电商详情页', desc: '主推产品详情页设计，强调卖点', creatorName: '黄丽', relation: '王珏什的朋友', status: '需求确认' }
  ],
  u3: [
    { id: 'c10', title: '培训课件制作', desc: '新员工培训PPT，约50页', creatorName: '林峰', relation: '米娅林的朋友', status: '服务进度' },
    { id: 'c11', title: '展厅导视设计', desc: '办公展厅导视系统，现代简约风', creatorName: '徐娜', relation: '米娅林的朋友', status: '预约沟通' },
    { id: 'c12', title: '包装设计', desc: '礼盒包装升级，环保材质方向', creatorName: '马超', relation: '米娅林的朋友', status: '需求确认' }
  ],
  u4: [
    { id: 'c13', title: '社群运营方案', desc: '私域社群月度运营方案和执行', creatorName: '朱迪', relation: '何诗怡的朋友', status: '需求确认' },
    { id: 'c14', title: '直播间搭建', desc: '产品直播间背景和设备清单', creatorName: '胡凯', relation: '何诗怡的朋友', status: '服务进度' },
    { id: 'c15', title: '周年庆策划', desc: '公司十周年庆活动整体策划', creatorName: '杨帆', relation: '何诗怡的朋友', status: '预约沟通' }
  ]
};

Page({
  data: {
    statusBarHeight: 44,
    heroPaddingTop: 64,
    contentScrollHeight: 500,
    selectedHelperId: '',
    helpers: MOCK_HELPERS,
    cards: []
  },

  onLoad() {
    this.updateSystemInfo();
    const firstUser = this.data.helpers.find((h) => h.type === 'user');
    if (firstUser) {
      this.setData({
        selectedHelperId: firstUser.id,
        cards: MOCK_NETWORK_CARDS[firstUser.id] || []
      });
    }
    this.calcScrollHeight();
  },

  calcScrollHeight() {
    try {
      const sys = wx.getSystemInfoSync();
      const windowHeight = sys.windowHeight || 667;
      const safeAreaBottom = sys.safeArea ? (sys.screenHeight - sys.safeArea.bottom) : 0;
      const tabBarHeight = 50 + safeAreaBottom;

      const query = wx.createSelectorQuery();
      query.select('.hero').boundingClientRect();
      query.select('.section-header').boundingClientRect();
      query.exec((res) => {
        const heroRect = res[0];
        const headerRect = res[1];
        if (!heroRect || !headerRect) return;
        const scrollHeight = windowHeight - heroRect.height - headerRect.height - tabBarHeight;
        this.setData({ contentScrollHeight: Math.max(200, scrollHeight) });
      });
    } catch (e) {
      // 使用默认值
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
    this.refreshCards(id);
  },

  refreshCards(helperId) {
    // 静态阶段从 mock 数据切换，后续接入 getNetworkCards
    const cards = MOCK_NETWORK_CARDS[helperId] || [];
    this.setData({ cards });
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
