const { getNavInfo, getSafeAreaBottom } = require('../../utils/ui');
const { membershipPlans } = require('../../config/env');

// 开发自测开关：true 时档位列表额外展示 test（1 元测试道具，env.js 里 hidden:true），
// 用于沙箱支付链路自测；正式提交/发布前必须保持 false
const SHOW_TEST_PLAN = true;

// 会员权益（按 2026-08-12 设计稿文案）
const BENEFITS = [
  { title: '像发微信一样随手记', desc: '文字、语音、截图、聊天记录，不用打开小程序' },
  { title: '记事助理提醒', desc: '私助 1V1，不漏事，不招人烦。' },
  { title: '把日常琐碎变成精彩创意', desc: '灵感、截图、转发私助，AI 分析整理成完整灵感卡' },
  { title: '跨屏多端同步', desc: '后续 Mac 端应用，其他社交场景插件自动同步' },
  { title: '事项群，协作记录整理，提醒', desc: '用完解散，记录留卡' },
  { title: '一键喂 AI', desc: '支持导出 AI 可读格式，ChatGPT / Claude 无缝使用' },
  { title: '新玩具终身领', desc: '时光轴、数据看板、探索功能……永久会员终身免费解锁。' }
];

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    loading: true,
    // none 未开通 / active 有效期中 / expired 已过期
    status: 'none',
    // monthly 月卡 / yearly 年卡 / lifetime 终身会员
    plan: '',
    expireAtText: '',
    daysLeft: 0,
    // 是否已绑定企业微信私人助理
    hasWecomBound: false,
    // 会员码（会员身份证+绑定码合一，已添加过助手的会员把码发给 TA 完成连接）
    memberCode: '',
    wecomBoundAtText: '',
    // 档位卡片从 config/env.js 读取（hidden 档位不展示，test 仅供开发自测）
    plans: membershipPlans.filter((p) => SHOW_TEST_PLAN || !p.hidden),
    // 当前选中档位（默认年卡）与支付按钮文案
    selectedPlan: 'yearly',
    payBtnText: '',
    paying: false,
    // 重新连接按钮的二次确认态（true 时按钮变红，再点一次执行解绑）
    unbindConfirming: false,
    // 底部安全区（px）：安卓 env() 失效，JS 计算
    safeAreaBottom: 12,
    benefits: BENEFITS
  },

  onLoad() {
    const navInfo = getNavInfo();
    // 首帧优化：用缓存的上次会员状态先渲染（底部选价区不等云函数返回即出现），
    // onShow 拿到最新状态后校正；无缓存时维持 loading，避免开通用户看到选价区闪现
    const cached = wx.getStorageSync('memberStatus') || null;
    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight,
      safeAreaBottom: getSafeAreaBottom(),
      loading: !cached,
      status: cached ? cached.status : 'none',
      plan: cached ? cached.plan : ''
    });
    this.updatePayBtnText();
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
          plan: d.plan || '',
          // 终身会员 daysLeft 为 null，不展示剩余天数
          daysLeft: d.daysLeft || 0,
          expireAtText: d.expireAt ? this.formatDate(d.expireAt) : '',
          hasWecomBound: !!d.hasWecomBound,
          memberCode: d.memberCode || '',
          wecomBoundAtText: d.wecomBoundAt ? this.formatDate(d.wecomBoundAt) : ''
        });
        // 缓存本次状态供下次进入时首帧渲染（见 onLoad）
        wx.setStorageSync('memberStatus', { status: d.status || 'none', plan: d.plan || '' });
        // 记录绑定状态供首页跳变检测（绑定成功的半弹窗反馈）
        wx.setStorageSync('JISHIKA_WECOM_BOUND', !!d.hasWecomBound);
        this.updatePayBtnText();
      })
      .catch((e) => {
        console.warn('loadStatus error', e);
        this.setData({ loading: false });
      });
  },

  // 档位卡片点击选中
  onSelectPlan(e) {
    const plan = e.currentTarget.dataset.plan;
    if (!plan || plan === this.data.selectedPlan) return;
    this.setData({ selectedPlan: plan });
    this.updatePayBtnText();
  },

  // 支付按钮文案：「立即开通 · 年卡 ¥99」（已过期为「立即续费 · …」）
  updatePayBtnText() {
    const p = this.data.plans.find((item) => item.plan === this.data.selectedPlan);
    if (!p) return;
    const prefix = this.data.status === 'expired' ? '立即续费' : '立即开通';
    this.setData({ payBtnText: `${prefix} · ${p.label} ¥${p.price}` });
  },

  // 立即开通：wx.login → prepareOrder → wx.requestVirtualPayment → confirmOrder 查单兜底
  // 发货不依赖 success 回调（另有控制台消息推送通道），success 后这里最多轮询 3 次确认
  onPay() {
    if (this.data.paying) return;
    const plan = this.data.selectedPlan;
    this.setData({ paying: true });

    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          this.setData({ paying: false });
          wx.showToast({ title: '登录失败，请重试', icon: 'none' });
          return;
        }
        wx.cloud.callFunction({
          name: 'virtualPayment',
          data: { action: 'prepareOrder', plan, code: loginRes.code }
        })
          .then((res) => {
            const r = res.result || {};
            if (r.code !== 0) {
              throw new Error(r.message || '下单失败');
            }
            const d = r.data;
            wx.requestVirtualPayment({
              mode: 'short_series_goods',
              signData: d.signData,
              paySig: d.paySig,
              signature: d.signature,
              success: () => this.confirmOrder(d.outTradeNo, plan),
              fail: (err) => {
                this.setData({ paying: false });
                const msg = (err && err.errMsg) || '';
                // 用户取消支付：静默不提示
                if (msg.indexOf('cancel') === -1) {
                  console.warn('requestVirtualPayment error', err);
                  wx.showToast({ title: '支付失败，请重试', icon: 'none' });
                }
              }
            });
          })
          .catch((err) => {
            console.warn('prepareOrder error', err);
            this.setData({ paying: false });
            wx.showToast({ title: err.message || '下单失败，请重试', icon: 'none' });
          });
      },
      fail: (err) => {
        console.warn('wx.login error', err);
        this.setData({ paying: false });
        wx.showToast({ title: '登录失败，请重试', icon: 'none' });
      }
    });
  },

  // 查单确认开通：最多轮询 3 次，间隔 2s（发货推送可能先到，confirmOrder 幂等）
  confirmOrder(outTradeNo, plan) {
    wx.showLoading({ title: '确认开通中…', mask: true });
    let attempt = 0;
    const tryConfirm = () => {
      attempt += 1;
      wx.cloud.callFunction({
        name: 'virtualPayment',
        data: { action: 'confirmOrder', outTradeNo }
      })
        .then((res) => {
          const r = res.result || {};
          if (r.code === 0 && r.data && r.data.paid) {
            wx.hideLoading();
            this.setData({ paying: false });
            // 跳转到开通成功页（redirectTo 不占返回栈，成功页「完成」返回上一页）
            wx.redirectTo({ url: '/pages/member-success/member-success?plan=' + plan });
          } else if (attempt < 3) {
            setTimeout(tryConfirm, 2000);
          } else {
            // 3 次仍未确认：支付成功但开通延迟，发货推送/后台会兜底完成
            wx.hideLoading();
            this.setData({ paying: false });
            wx.showToast({ title: '支付成功，开通确认中，请稍后下拉刷新查看', icon: 'none' });
            this.loadStatus();
          }
        })
        .catch((err) => {
          console.warn('confirmOrder error', err);
          wx.hideLoading();
          this.setData({ paying: false });
          wx.showToast({ title: '确认失败，请稍后查看', icon: 'none' });
        });
    };
    tryConfirm();
  },

  // 复制会员码：会员把码发给企微私人助理完成连接（主路径）
  onCopyMemberCode() {
    if (!this.data.memberCode) return;
    wx.setClipboardData({
      data: this.data.memberCode,
      success: () => wx.showToast({ title: '已复制', icon: 'success' })
    });
  },

  // 查看私聊新卡：跳首页强制弹出私聊卡弹窗（不受每日一次限制）
  onViewWecomCards() {
    wx.redirectTo({ url: '/pages/home/home?wecomSheet=1' });
  },

  // 重新连接：页面内二次确认（不用 wx.showModal——该 API 在本页真机/模拟器均 pending 不渲染，原因未明，绕开）
  // 第一次点进入确认态（按钮变红、文案变"再点一次确认断开"），3 秒内再点执行解绑，超时恢复
  onUnbind() {
    if (!this.data.unbindConfirming) {
      this.setData({ unbindConfirming: true });
      clearTimeout(this._unbindTimer);
      this._unbindTimer = setTimeout(() => this.setData({ unbindConfirming: false }), 3000);
      return;
    }
    clearTimeout(this._unbindTimer);
    this.setData({ unbindConfirming: false });
    wx.cloud.callFunction({ name: 'membership', data: { action: 'unbind' } })
      .then((r) => {
        const result = r.result || {};
        if (result.code === 0) {
          wx.showToast({ title: '已断开', icon: 'success' });
          this.loadStatus();
        } else {
          wx.showToast({ title: result.message || '操作失败，请重试', icon: 'none' });
        }
      })
      .catch((err) => {
        console.warn('unbind error', err);
        wx.showToast({ title: '操作失败，请重试', icon: 'none' });
      });
  },

  formatDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
});
