const { getNavInfo } = require('../../utils/ui');
const { membershipPlans } = require('../../config/env');

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    loading: true,
    isAdmin: false,
    keyword: '',
    users: [],
    granting: '' // 正在开通的 openid（按钮 loading 态）
  },

  onLoad() {
    const navInfo = getNavInfo();
    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight
    });
    this.checkAdmin();
  },

  callMembership(data) {
    return wx.cloud.callFunction({ name: 'membership', data }).then((res) => {
      const result = (res && res.result) || {};
      if (result.code !== 0) throw new Error(result.message || '操作失败');
      return result.data || {};
    });
  },

  checkAdmin() {
    this.callMembership({ action: 'checkAdmin' })
      .then((d) => {
        this.setData({ loading: false, isAdmin: !!d.isAdmin });
        if (d.isAdmin) this.loadUsers();
      })
      .catch(() => this.setData({ loading: false }));
  },

  loadUsers() {
    return this.callMembership({ action: 'listUsers', keyword: this.data.keyword })
      .then((d) => {
        // listUsers 返回里有 plan 就映射为档位名展示，没有则不显示
        const users = (d.users || []).map((u) => {
          const p = membershipPlans.find((item) => item.plan === u.plan);
          return Object.assign({}, u, { planLabel: p ? p.label : '' });
        });
        this.setData({ users });
      })
      .catch((e) => wx.showToast({ title: e.message, icon: 'none' }));
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.loadUsers();
  },

  // 开通/续期：先选档位，确认后带 plan 调 grant
  onGrant(e) {
    const { openid, nickname } = e.currentTarget.dataset;
    if (!openid || this.data.granting) return;

    // 过滤 hidden 档位（test 测试档仅开发自测用，不进管理员开通菜单）
    const grantPlans = membershipPlans.filter((p) => !p.hidden);
    wx.showActionSheet({
      itemList: grantPlans.map((p) => `${p.label} ¥${p.price}`),
      success: (sheet) => {
        const plan = grantPlans[sheet.tapIndex];
        if (!plan) return;
        wx.showModal({
          title: '开通会员',
          content: `确认为「${nickname}」开通/续期${plan.label}（¥${plan.price}）？`,
          confirmText: '确认开通',
          success: (res) => {
            if (!res.confirm) return;
            this.setData({ granting: openid });
            this.callMembership({ action: 'grant', targetOpenid: openid, plan: plan.plan, remark: '管理页手动开通' })
              .then(() => {
                wx.showToast({ title: '已开通', icon: 'success' });
                return this.loadUsers();
              })
              .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
              .finally(() => this.setData({ granting: '' }));
          }
        });
      }
    });
  },

  formatExpire(e) {
    // wxml 不便处理时间戳，列表渲染前已可格式化；此处备用
    return e;
  }
});
