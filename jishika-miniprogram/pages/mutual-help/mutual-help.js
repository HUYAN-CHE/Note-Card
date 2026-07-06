const { collections } = require('../../config/env');

const STORAGE_KEY = 'JISHIKA_USER_PROFILE';

function getInitial(name) {
  if (!name) return '';
  return name.trim().charAt(0);
}

const MOCK_HELPERS = [
  { id: 'add', type: 'add', name: '添加', avatar: '' },
  { id: 'u1', type: 'user', name: '李群', avatar: '', color: '#4A90E2', initial: '李' },
  { id: 'u2', type: 'user', name: '王珏什', avatar: '', color: '#7B61FF', initial: '王' },
  { id: 'u3', type: 'user', name: '米娅林', avatar: '', color: '#FF9F43', initial: '米' },
  { id: 'u4', type: 'user', name: '何诗怡', avatar: '', color: '#FF6B81', initial: '何' },
  { id: 'u5', type: 'user', name: '张明', avatar: '', color: '#2ECC71', initial: '张' },
  { id: 'u6', type: 'user', name: '刘洋', avatar: '', color: '#1ABC9C', initial: '刘' },
  { id: 'u7', type: 'user', name: '陈静', avatar: '', color: '#E74C3C', initial: '陈' },
  { id: 'u8', type: 'user', name: '赵磊', avatar: '', color: '#9B59B6', initial: '赵' },
  { id: 'u9', type: 'user', name: '孙婷', avatar: '', color: '#3498DB', initial: '孙' }
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
    cards: [],
    myProfile: {
      nickname: '',
      avatar: '',
      initial: ''
    },
    loadingHelpers: false,
    loadingCards: false
  },

  onLoad() {
    this.updateSystemInfo();
    this.loadMyProfile();
    this.loadHelpers();
  },

  async loadMyProfile() {
    const app = getApp();
    const globalProfile = app.globalData && app.globalData.userProfile;
    const local = wx.getStorageSync(STORAGE_KEY);
    const cached = globalProfile || local;

    let profile = cached && (cached.nickname || cached.avatar)
      ? { nickname: cached.nickname, avatar: cached.avatar, initial: cached.initial || cached.nickname.charAt(0) }
      : { nickname: '', avatar: '', initial: '' };

    try {
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const openid = app.globalData.openid || wx.getStorageSync('JISHIKA_OPENID');
        if (openid) {
          const res = await wx.cloud.database()
            .collection(collections.users)
            .where({ openid })
            .limit(1)
            .get();
          const cloudUser = res.data && res.data[0];
          if (cloudUser) {
            profile = {
              nickname: cloudUser.nickName || '',
              avatar: cloudUser.avatarUrl || '',
              initial: cloudUser.initial || ''
            };
            const nextProfile = { ...profile, serviceTags: cloudUser.tags || [] };
            wx.setStorageSync(STORAGE_KEY, nextProfile);
            app.globalData.userProfile = nextProfile;
          }
        }
      }
    } catch (error) {
      // 忽略云端读取失败
    }

    this.setData({ myProfile: profile });
  },

  async loadHelpers() {
    this.setData({ loadingHelpers: true });

    try {
      const res = await wx.cloud.callFunction({ name: 'getMutualHelpers' });
      const helpers = (res.result && res.result.data) || [];

      if (helpers.length) {
        const list = [{ id: 'add', type: 'add', name: '添加', avatar: '' }, ...helpers];
        const firstUser = list.find((h) => h.type === 'user');
        this.setData({
          helpers: list,
          selectedHelperId: firstUser ? firstUser.id : ''
        });
        if (firstUser) {
          await this.loadNetworkCards(firstUser.id);
        }
      } else {
        // 云端没有数据时回退到 mock
        const firstUser = MOCK_HELPERS.find((h) => h.type === 'user');
        this.setData({
          helpers: MOCK_HELPERS,
          selectedHelperId: firstUser ? firstUser.id : ''
        });
        if (firstUser) {
          this.setData({ cards: MOCK_NETWORK_CARDS[firstUser.id] || [] });
        }
      }
    } catch (error) {
      // 云函数未部署或调用失败时回退到 mock
      const firstUser = MOCK_HELPERS.find((h) => h.type === 'user');
      this.setData({
        helpers: MOCK_HELPERS,
        selectedHelperId: firstUser ? firstUser.id : ''
      });
      if (firstUser) {
        this.setData({ cards: MOCK_NETWORK_CARDS[firstUser.id] || [] });
      }
    } finally {
      this.setData({ loadingHelpers: false });
      this.calcScrollHeight();
    }
  },

  async loadNetworkCards(helperId) {
    if (!helperId || helperId === 'add') return;
    this.setData({ loadingCards: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'getNetworkCards',
        data: { helperOpenid: helperId }
      });
      const cards = (res.result && res.result.data) || [];
      this.setData({ cards });
    } catch (error) {
      // 回退到 mock
      this.setData({ cards: MOCK_NETWORK_CARDS[helperId] || [] });
    } finally {
      this.setData({ loadingCards: false });
    }
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
    this.loadNetworkCards(helperId);
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

  onChooseAvatar(event) {
    const avatarUrl = event.detail.avatarUrl;
    if (avatarUrl) {
      this.saveMyProfile({ avatar: avatarUrl });
    }
  },

  onChooseNickname(event) {
    const nickname = event.detail.value;
    if (nickname) {
      this.saveMyProfile({ nickname });
    }
  },

  async saveMyProfile(patch) {
    const { myProfile } = this.data;
    const nickname = patch.nickname !== undefined ? patch.nickname : myProfile.nickname;
    const nextProfile = {
      ...myProfile,
      ...patch,
      nickname,
      initial: getInitial(nickname)
    };

    this.setData({ myProfile: nextProfile });

    const fullProfile = { ...nextProfile, serviceTags: [] };
    wx.setStorageSync(STORAGE_KEY, fullProfile);
    try {
      const app = getApp();
      if (app.globalData) app.globalData.userProfile = fullProfile;
    } catch (e) {}

    try {
      const app = getApp();
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const openid = app.globalData.openid || wx.getStorageSync('JISHIKA_OPENID');
        if (openid) {
          const db = wx.cloud.database();
          const res = await db.collection(collections.users)
            .where({ openid })
            .limit(1)
            .get();
          const data = {
            openid,
            nickName: nextProfile.nickname,
            avatarUrl: nextProfile.avatar,
            initial: nextProfile.initial,
            updatedAt: Date.now()
          };
          if (res.data && res.data[0] && res.data[0]._id) {
            await db.collection(collections.users).doc(res.data[0]._id).update({ data });
          } else {
            await db.collection(collections.users).add({
              data: { ...data, createdAt: Date.now() }
            });
          }
        }
      }
    } catch (error) {
      // 忽略云端保存失败
    }
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
