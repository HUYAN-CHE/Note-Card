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

  // 模拟企微绑定：调 bindByCode（将来会话存档服务识别会员码后走同一接口）
  // editable 弹窗可改 externalUserid，默认填测试 ID，方便测幂等/冲突场景
  onMockBind(e) {
    const { code } = e.currentTarget.dataset;
    if (!code) return;
    const defaultId = 'wmTEST_' + code;
    wx.showModal({
      title: '模拟企微绑定',
      editable: true,
      placeholderText: 'externalUserid',
      content: defaultId,
      confirmText: '绑定',
      success: (res) => {
        if (!res.confirm) return;
        const externalUserid = (res.content || '').trim() || defaultId;
        this.callMembership({ action: 'bindByCode', code, externalUserid })
          .then(() => {
            wx.showToast({ title: '绑定成功', icon: 'success' });
            return this.loadUsers();
          })
          .catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
      }
    });
  },

  // 模拟私聊：已绑定用户发一条文本消息，走 wecomIngest 全链路（等同存档容器拉到消息后的调用）
  onMockChat(e) {
    const externalUserid = e.currentTarget.dataset.externalUserid;
    if (!externalUserid) return;
    wx.showModal({
      title: '模拟私聊消息',
      editable: true,
      placeholderText: '输入会员发给助手的内容',
      confirmText: '发送',
      success: (res) => {
        if (!res.confirm) return;
        const content = (res.content || '').trim();
        if (!content) return;
        wx.cloud.callFunction({
          name: 'wecomIngest',
          data: { action: 'ingest', externalUserid, msgType: 'text', content, msgTime: Date.now() }
        }).then((r) => {
          const result = (r && r.result) || {};
          const d = result.data || {};
          if (result.code !== 0) throw new Error(result.message || '调用失败');
          // result: card 成卡 / bound 完成绑定 / pending 进待认领区
          if (d.result === 'card') {
            wx.showModal({ title: '已记成卡片', content: `《${d.title}》${d.aiParsed ? '' : '（AI 失败，原文兜底）'}`, showCancel: false });
          } else if (d.result === 'inspire') {
            wx.showModal({ title: '已沉淀到灵感库', content: `《${d.title}》${d.matched ? '（归入已有主题）' : '（新建灵感卡）'}`, showCancel: false });
          } else if (d.result === 'bound') {
            wx.showToast({ title: '已完成绑定', icon: 'success' });
          } else {
            wx.showModal({ title: '进入待认领区', content: `原因：${d.reason || 'unknown'}`, showCancel: false });
          }
        }).catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
      }
    });
  },

  formatExpire(e) {
    // wxml 不便处理时间戳，列表渲染前已可格式化；此处备用
    return e;
  }
});
