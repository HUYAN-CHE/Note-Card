const { getNavInfo } = require('../../utils/ui');

// 会员权益（文案与 my-home 会员 banner 呼应）
const BENEFITS = [
  { title: '专属 AI 助手', desc: '灵感与记事，在微信里随手发给它' },
  { title: '灵感集采成文', desc: '零碎灵感自动汇总，AI 提取标题与关键词成文章' },
  { title: '聊天整理成卡', desc: '聊天记录转发给 AI 助手，自动整理成记事卡' },
  { title: '事项到期提醒', desc: '重要事项到期，主动推送提醒' },
  { title: '多端同步（规划中）', desc: 'Mac 版应用即将推出，全端数据打通' }
];

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    loading: true,
    // none 未开通 / active 有效期中 / expired 已过期
    status: 'none',
    expireAtText: '',
    daysLeft: 0,
    benefits: BENEFITS
  },

  onLoad() {
    const navInfo = getNavInfo();
    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight
    });
  },

  onShow() {
    this.loadStatus();
  },

  loadStatus() {
    wx.cloud.callFunction({ name: 'membership', data: { action: 'getStatus' } })
      .then((res) => {
        const d = (res.result && res.result.data) || {};
        this.setData({
          loading: false,
          status: d.status || 'none',
          daysLeft: d.daysLeft || 0,
          expireAtText: d.expireAt ? this.formatDate(d.expireAt) : ''
        });
      })
      .catch((e) => {
        console.warn('loadStatus error', e);
        this.setData({ loading: false });
      });
  },

  formatDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
});
