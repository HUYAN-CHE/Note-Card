const { getNavInfo, getSafeAreaBottom } = require('../../utils/ui');
const { collections } = require('../../config/env');
const { uploadAvatar } = require('../../utils/upload-avatar');

const USER_PROFILE_KEY = 'JISHIKA_USER_PROFILE';

function cleanNickname(name) {
  if (!name || String(name).trim() === '我') return '';
  return String(name).trim();
}

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    loading: true,
    inviterName: '',
    // 待留意卡片清单：[{ refCode, title, deadline }]
    cards: [],
    accepting: false,
    accepted: false,
    // 留意成功后的卡片清单（带 id，可点进详情）
    acceptedCards: [],
    // 授权补全弹窗（与卡详情页同款）
    showAuthModal: false,
    authProfile: {
      nickname: '',
      avatar: '',
      initial: ''
    }
  },

  onLoad(options) {
    const navInfo = getNavInfo();
    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight,
      // 底部安全区（px）：安卓 env() 失效，JS 计算
      safeAreaBottom: getSafeAreaBottom()
    });

    // 分享链接参数：refs 逗号分隔的卡片短码 + inviter 邀请人 openid
    this.refs = (options.refs || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    this.inviter = options.inviter || '';

    if (!this.refs.length) {
      this.setData({ loading: false });
      wx.showToast({ title: '链接缺少卡片信息', icon: 'none' });
      return;
    }

    this.loadInviterName();
    this.loadCards();
  },

  // 邀请人昵称：直查 users 集合（查不到显示「好友」）
  async loadInviterName() {
    if (!this.inviter) return;
    try {
      const app = getApp();
      if (!app.globalData || !app.globalData.cloudReady || !wx.cloud) return;
      const res = await wx.cloud.database()
        .collection(collections.users)
        .where({ _openid: this.inviter })
        .limit(1)
        .get();
      const user = res.data && res.data[0];
      const nickname = cleanNickname(user && user.nickName);
      if (nickname) this.setData({ inviterName: nickname });
    } catch (e) {
      // 昵称拉取失败不阻塞页面
    }
  },

  // 逐卡解析短码取标题/截止时间（resolveCardRef 不暴露敏感字段）
  async loadCards() {
    const cards = [];
    for (const ref of this.refs) {
      try {
        const res = await wx.cloud.callFunction({
          name: 'resolveCardRef',
          data: { code: ref }
        });
        if (res.result && res.result.code === 0 && res.result.card) {
          const card = res.result.card;
          cards.push({
            refCode: ref,
            title: (card.title || '').trim() || '未命名事项',
            deadline: card.deadline || ''
          });
        }
      } catch (e) {
        // 单卡解析失败跳过，不阻塞其余卡
      }
    }
    this.setData({ cards, loading: false });
  },

  // 「打开提醒」：先弹微信订阅授权（无论授权结果都继续 acceptWatch，额度由云端补记）
  async onAcceptTap() {
    if (this.data.accepting || this.data.accepted || !this.refs.length) return;

    const tmplIds = ((getApp().globalData && getApp().globalData.reminderTemplateIds) || []).filter(Boolean);
    if (tmplIds.length) {
      await new Promise((resolve) => {
        wx.requestSubscribeMessage({
          tmplIds,
          success: () => resolve(),
          fail: () => resolve()
        });
      });
    }

    this.setData({ accepting: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'watchOps',
        data: { action: 'acceptWatch', refs: this.refs, inviter: this.inviter }
      });

      if (res.result && res.result.code === 0) {
        const d = res.result.data || {};
        // cards 只含本次新留意的卡；全部已留意时回退展示原始清单（无 id，不可点）
        const acceptedCards = Array.isArray(d.cards) && d.cards.length ? d.cards : [];
        this.setData({
          accepting: false,
          accepted: true,
          acceptedCards
        });
        // 被邀请人可能从未授权过：补弹授权，便于卡主在消息/记录里认出 TA
        this.checkAuth();
      } else {
        this.setData({ accepting: false });
        wx.showToast({ title: (res.result && res.result.message) || '操作失败', icon: 'none' });
      }
    } catch (e) {
      this.setData({ accepting: false });
      wx.showToast({ title: '操作失败，请重试', icon: 'none' });
    }
  },

  // 留意成功后的卡片：有 id 的可点进卡详情
  onAcceptedCardTap(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/card-detail/card-detail?id=${id}` });
  },

  onDone() {
    wx.redirectTo({ url: '/pages/home/home' });
  },

  // ==================== 授权补全（与卡详情页同款逻辑） ====================

  // 判定口径与首页 home.js checkAuth 一致：本地缓存有效即用，否则回源云端 users 表
  async checkAuth() {
    let profile = wx.getStorageSync(USER_PROFILE_KEY) || {};
    let nickname = profile.nickname && String(profile.nickname).trim();
    let authorized = Boolean(nickname && nickname !== '我' && profile.avatar);

    if (!authorized) {
      const cloudProfile = await this.fetchCloudProfile();
      if (cloudProfile) {
        profile = cloudProfile;
        nickname = cloudProfile.nickname;
        authorized = true;
        wx.setStorageSync(USER_PROFILE_KEY, cloudProfile);
        try {
          getApp().globalData.userProfile = cloudProfile;
        } catch (e) {}
      }
    }

    if (authorized) return;

    const safeNickname = nickname === '我' ? '' : nickname;
    this.setData({
      showAuthModal: true,
      authProfile: {
        nickname: safeNickname || '',
        avatar: profile.avatar || '',
        initial: profile.initial || (safeNickname ? safeNickname.charAt(0).toUpperCase() : '')
      }
    });
  },

  // 从云端 users 表读授权信息；无有效记录返回 null（同首页 fetchCloudProfile）
  async fetchCloudProfile() {
    try {
      const app = getApp();
      if (!app.globalData || !app.globalData.cloudReady || !wx.cloud) return null;
      // 冷启动竞态：app 的 login 云函数是异步的，openid 可能还没就绪，短暂等待
      let openid = app.globalData.openid || wx.getStorageSync('JISHIKA_OPENID');
      if (!openid) {
        for (let i = 0; i < 10 && !openid; i++) {
          await new Promise((r) => setTimeout(r, 300));
          openid = app.globalData.openid || wx.getStorageSync('JISHIKA_OPENID');
        }
      }
      if (!openid) return null;
      const db = wx.cloud.database();
      const res = await db.collection(collections.users)
        .where({ _openid: openid })
        .limit(1)
        .get();
      const user = res.data && res.data[0];
      if (!user) return null;
      const nickname = user.nickName && String(user.nickName).trim();
      if (!nickname || nickname === '我' || !user.avatarUrl) return null;
      return {
        nickname,
        avatar: user.avatarUrl,
        initial: user.initial || nickname.charAt(0).toUpperCase(),
        serviceTags: Array.isArray(user.serviceTags) ? user.serviceTags : []
      };
    } catch (e) {
      return null;
    }
  },

  async onAuthAvatar(event) {
    const tempUrl = event.detail.avatarUrl;
    if (!tempUrl) return;
    // 先用临时路径即时显示；上传云存储成功后换 cloud:// fileID（临时路径重启即失效）
    this.setData({ 'authProfile.avatar': tempUrl });
    const fileID = await uploadAvatar(tempUrl);
    // 上传失败不保留微信临时路径：http://tmp 在其他用户设备上加载不了，写库即裂图
    this.setData({ 'authProfile.avatar': fileID || '' });
    this.tryFinishAuth();
  },

  onAuthNicknameInput(event) {
    const nickname = event.detail.value || '';
    this.setData({ 'authProfile.nickname': nickname });
    if (nickname.trim()) {
      this.setAuthNickname(nickname.trim());
    }
  },

  setAuthNickname(nickname) {
    const initial = nickname.trim().charAt(0).toUpperCase();
    this.setData({
      'authProfile.nickname': nickname,
      'authProfile.initial': initial
    }, () => {
      this.tryFinishAuth();
    });
  },

  async tryFinishAuth() {
    const { authProfile } = this.data;
    if (!authProfile.nickname || !authProfile.avatar) return;
    await this.finishAuth({ ...authProfile, serviceTags: [] });
  },

  // upsert users 与卡详情页 finishAuth 一致
  async finishAuth(profile) {
    const safeProfile = {
      nickname: cleanNickname(profile.nickname),
      avatar: profile.avatar || '',
      initial: profile.initial && String(profile.initial).trim() !== '我' ? String(profile.initial).trim() : '',
      serviceTags: Array.isArray(profile.serviceTags) ? profile.serviceTags : []
    };
    if (safeProfile.nickname && !safeProfile.initial) {
      safeProfile.initial = safeProfile.nickname.charAt(0).toUpperCase();
    }

    wx.setStorageSync(USER_PROFILE_KEY, safeProfile);
    try {
      const app = getApp();
      if (app.globalData) app.globalData.userProfile = safeProfile;
    } catch (e) {}

    this.setData({ showAuthModal: false });

    try {
      const app = getApp();
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const openid = app.globalData.openid || wx.getStorageSync('JISHIKA_OPENID');
        if (openid) {
          const db = wx.cloud.database();
          const res = await db.collection(collections.users)
            .where({ _openid: openid })
            .limit(1)
            .get();
          // 注意：_openid 是系统保留字段不允许写入，add 时云库自动填充
          const data = {
            nickName: safeProfile.nickname,
            avatarUrl: safeProfile.avatar,
            initial: safeProfile.initial,
            serviceTags: safeProfile.serviceTags,
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
      console.error('[finishAuth] 授权信息同步云端失败', error);
    }
  },

  closeAuthModal() {
    this.setData({ showAuthModal: false });
  },

  onPreventBubble() {},

  onShareAppMessage() {
    return {
      title: '记事卡｜一起协作，互相帮忙',
      path: '/pages/mutual-help/mutual-help'
    };
  }
});
