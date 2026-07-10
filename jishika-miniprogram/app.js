const { normalizeLaunchContext } = require('./services/ai-adapter');
const { enableCloud, cloudEnvId, collections } = require('./config/env');

App({
  globalData: {
    launchContext: null,
    reminderTemplateIds: [],
    cloudReady: false,
    storeMode: 'local',
    userInfo: null,
    openid: ''
  },

  onLaunch(options) {
    this.initCloud();
    this.captureLaunchContext(options);
    this.fetchUserOpenid();
  },

  onShow(options) {
    this.captureLaunchContext(options);
  },

  captureLaunchContext(options = {}) {
    const context = normalizeLaunchContext(options);

    if (context.hasContext) {
      this.globalData.launchContext = {
        ...context,
        consumed: false
      };
    }
  },

  initCloud() {
    if (!enableCloud || !wx.cloud) {
      this.globalData.cloudReady = false;
      this.globalData.storeMode = 'local';
      return;
    }

    try {
      wx.cloud.init({
        env: cloudEnvId || undefined,
        traceUser: true
      });

      this.globalData.cloudReady = true;
      this.globalData.storeMode = 'cloud';
    } catch (error) {
      this.globalData.cloudReady = false;
      this.globalData.storeMode = 'local';
    }
  },

  async fetchUserOpenid() {
    if (!this.globalData.cloudReady || !wx.cloud) return;

    try {
      const res = await wx.cloud.callFunction({ name: 'login' });
      const openid = res.result && res.result.openid;
      if (openid) {
        this.globalData.openid = openid;
        wx.setStorageSync('JISHIKA_OPENID', openid);
        await this.fetchUserProfile(openid);
      }
    } catch (error) {
      // 云函数未部署或网络异常时，尝试读取本地缓存
      const cached = wx.getStorageSync('JISHIKA_OPENID');
      if (cached) {
        this.globalData.openid = cached;
        await this.fetchUserProfile(cached);
      }
    }
  },

  async fetchUserProfile(openid) {
    if (!openid || !wx.cloud) return;

    try {
      const res = await wx.cloud.database()
        .collection(collections.users)
        .where({ _openid: openid })
        .limit(1)
        .get();
      const user = res.data && res.data[0];
      if (user) {
        const profile = {
          nickname: user.nickName || '',
          avatar: user.avatarUrl || '',
          initial: user.initial || '',
          intro: user.intro || '',
          serviceTags: user.tags || []
        };
        this.globalData.userProfile = profile;
        wx.setStorageSync('JISHIKA_USER_PROFILE', profile);
      }
    } catch (error) {
      // 云端读取失败时读本地缓存
      const cached = wx.getStorageSync('JISHIKA_USER_PROFILE');
      if (cached) this.globalData.userProfile = cached;
    }
  }
});
