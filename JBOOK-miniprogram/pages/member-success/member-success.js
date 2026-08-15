const { getNavInfo } = require('../../utils/ui');
const { membershipPlans } = require('../../config/env');

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    // 档位展示（plan 无效/缺失时兜底「罐头会员」）
    planLabel: '罐头会员',
    validityText: '',
    // 会员码（会员身份证+绑定码，发给企微私人助理完成连接）
    memberCode: ''
  },

  onLoad(options) {
    const navInfo = getNavInfo();
    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight
    });

    // 按 query 参数 plan 从 env.js membershipPlans 映射档位名与有效期
    const p = membershipPlans.find((item) => item.plan === (options && options.plan));
    if (p) {
      this.setData({
        planLabel: p.label,
        validityText: p.plan === 'lifetime' ? '终身有效' : `有效期 ${p.days} 天`
      });
    }

    this.loadMemberCode();
  },

  // 开通后必已有会员码，直接取 getStatus 返回的 memberCode
  loadMemberCode() {
    wx.cloud.callFunction({ name: 'membership', data: { action: 'getStatus' } })
      .then((res) => {
        const d = (res.result && res.result.data) || {};
        this.setData({ memberCode: d.memberCode || '' });
      })
      .catch((e) => {
        console.warn('loadMemberCode error', e);
      });
  },

  // 复制会员码：会员把码发给企微私人助理完成连接（主路径）
  onCopyMemberCode() {
    if (!this.data.memberCode) return;
    wx.setClipboardData({
      data: this.data.memberCode,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  },

  // 完成：返回上一页；栈内无上一页时兜底回会员页
  onDone() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 });
    } else {
      wx.redirectTo({ url: '/pages/member/member' });
    }
  }
});
