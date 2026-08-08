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
    // 是否已绑定手机号：未绑定时开通入口替换为绑定引导
    hasPhone: false,
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
          expireAtText: d.expireAt ? this.formatDate(d.expireAt) : '',
          hasPhone: !!d.hasPhone
        });
      })
      .catch((e) => {
        console.warn('loadStatus error', e);
        this.setData({ loading: false });
      });
  },

  // 绑定手机号：getPhoneNumber 组件回调，成功后露出「添加 AI 助手」开通入口
  onGetPhoneNumber(e) {
    const detail = (e && e.detail) || {};
    if (!detail.code) {
      // 用户拒绝授权：轻提示，不打断
      if (detail.errMsg && detail.errMsg.indexOf('deny') !== -1) {
        wx.showToast({ title: '未授权，无法绑定', icon: 'none' });
      }
      return;
    }
    wx.cloud.callFunction({ name: 'membership', data: { action: 'bindPhone', code: detail.code } })
      .then((res) => {
        const r = res.result || {};
        if (r.code === 0) {
          this.setData({ hasPhone: true });
          wx.showToast({ title: '已绑定', icon: 'success' });
        } else {
          wx.showToast({ title: r.message || '绑定失败，请重试', icon: 'none' });
        }
      })
      .catch((err) => {
        console.warn('bindPhone error', err);
        wx.showToast({ title: '绑定失败，请重试', icon: 'none' });
      });
  },

  formatDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  // ==================== 联系我插件（排查用回调，真机 vConsole 可见） ====================

  onContactStart(e) {
    console.log('[contactCell] start', e && e.detail);
  },

  // completemessage: { errcode, name, headurl, notifytype }
  // notifytype 0=服务通知推送名片 1=展示二维码（插件两种正常方式之一，非故障）
  // errcode 负值才是真异常：-3002 配置获取失败 / -3004 授权失败 / -3005 客服消息发送失败 / -3006 已是好友 / -3008 未配置客服
  onContactComplete(e) {
    const d = (e && e.detail) || {};
    console.log('[contactCell] complete errcode=%s notifytype=%s name=%s', d.errcode, d.notifytype, d.name, d);
    if (d.errcode && d.errcode !== 0 && d.errcode !== -3006) {
      wx.showToast({ title: `添加助手失败(${d.errcode})，请截图反馈`, icon: 'none' });
    }
  }
});
