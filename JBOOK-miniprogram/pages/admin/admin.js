const { getNavInfo } = require('../../utils/ui');

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
      .then((d) => this.setData({ users: d.users || [] }))
      .catch((e) => wx.showToast({ title: e.message, icon: 'none' }));
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.loadUsers();
  },

  // 开通/续期一年
  onGrant(e) {
    const { openid, nickname } = e.currentTarget.dataset;
    if (!openid || this.data.granting) return;

    wx.showModal({
      title: '开通会员',
      content: `确认为「${nickname}」开通/续期一年会员？`,
      confirmText: '确认开通',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ granting: openid });
        this.callMembership({ action: 'grant', targetOpenid: openid, days: 365, remark: '管理页手动开通' })
          .then(() => {
            wx.showToast({ title: '已开通', icon: 'success' });
            return this.loadUsers();
          })
          .catch((err) => wx.showToast({ title: err.message, icon: 'none' }))
          .finally(() => this.setData({ granting: '' }));
      }
    });
  },

  formatExpire(e) {
    // wxml 不便处理时间戳，列表渲染前已可格式化；此处备用
    return e;
  }
});
