const { normalizeLaunchContext } = require('./services/ai-adapter');
const { enableCloud, cloudEnvId } = require('./config/env');

App({
  globalData: {
    launchContext: null,
    reminderTemplateIds: [],
    cloudReady: false,
    storeMode: 'local'
  },

  onLaunch(options) {
    this.initCloud();
    this.captureLaunchContext(options);
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
  }
});
