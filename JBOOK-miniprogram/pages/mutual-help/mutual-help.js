const { collections } = require('../../config/env');

const STORAGE_KEY = 'JISHIKA_USER_PROFILE';

function getInitial(name) {
  if (!name) return '';
  return name.trim().charAt(0);
}

function cleanNickname(name) {
  if (!name || String(name).trim() === '我') return '';
  return String(name).trim();
}

function cleanInitial(initial, name) {
  if (!initial || String(initial).trim() === '我') return getInitial(name);
  return String(initial).trim();
}

Page({
  data: {
    statusBarHeight: 44,
    heroPaddingTop: 64,
    contentScrollHeight: 500,
    selectedHelperId: '',
    helpers: [{ id: 'add', type: 'add', name: '添加', avatar: '' }],
    cards: [],
    myProfile: {
      nickname: '',
      avatar: '',
      initial: ''
    },
    authorized: false,
    loadingHelpers: false,
    loadingCards: false
  },

  onLoad() {
    this.updateSystemInfo();
    this.loadMyProfile();
  },

  async loadMyProfile() {
    const app = getApp();
    const globalProfile = app.globalData && app.globalData.userProfile;
    const local = wx.getStorageSync(STORAGE_KEY);
    const cached = globalProfile || local;

    const cachedNickname = cleanNickname(cached && cached.nickname);
    let profile = cachedNickname && cached.avatar
      ? { nickname: cachedNickname, avatar: cached.avatar, initial: cleanInitial(cached.initial, cachedNickname) }
      : { nickname: '', avatar: '', initial: '' };

    try {
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const openid = app.globalData.openid || wx.getStorageSync('JISHIKA_OPENID');
        if (openid) {
          const res = await wx.cloud.database()
            .collection(collections.users)
            .where({ _openid: openid })
            .limit(1)
            .get();
          const cloudUser = res.data && res.data[0];
          const cloudNickname = cleanNickname(cloudUser && cloudUser.nickName);
          if (cloudUser && (cloudNickname || cloudUser.avatarUrl)) {
            profile = {
              nickname: cloudNickname || profile.nickname,
              avatar: cloudUser.avatarUrl || profile.avatar,
              initial: cleanInitial(cloudUser.initial, cloudNickname || profile.nickname) || (cloudNickname ? cloudNickname.charAt(0) : '')
            };
            const nextProfile = { ...profile, serviceTags: cloudUser.serviceTags || [] };
            wx.setStorageSync(STORAGE_KEY, nextProfile);
            if (app.globalData) app.globalData.userProfile = nextProfile;
          }
        }
      }
    } catch (error) {
      // 忽略云端读取失败
    }

    const authorized = Boolean(profile.nickname && profile.nickname !== '我' && profile.avatar);
    this.setData({ myProfile: profile, authorized });

    if (authorized) {
      this.loadHelpers();
    }
  },

  async loadHelpers() {
    this.setData({ loadingHelpers: true });

    try {
      const res = await wx.cloud.callFunction({ name: 'getMutualHelpers' });
      const helpers = (res.result && res.result.data) || [];

      if (helpers.length) {
        const list = [{ id: 'add', type: 'add', name: '添加', avatar: '' }, ...helpers];
        const firstUser = list.find((h) => h.type === 'user');
        this.setData({
          helpers: list,
          selectedHelperId: firstUser ? firstUser.id : ''
        });
        if (firstUser) {
          await this.loadNetworkCards(firstUser.id);
        }
      } else {
        this.setData({
          helpers: [{ id: 'add', type: 'add', name: '添加', avatar: '' }],
          selectedHelperId: '',
          cards: []
        });
      }
    } catch (error) {
      this.setData({
        helpers: [{ id: 'add', type: 'add', name: '添加', avatar: '' }],
        selectedHelperId: '',
        cards: []
      });
    } finally {
      this.setData({ loadingHelpers: false });
      this.calcScrollHeight();
    }
  },

  async loadNetworkCards(helperId) {
    if (!helperId || helperId === 'add') return;
    this.setData({ loadingCards: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'getNetworkCards',
        data: { helperOpenid: helperId }
      });
      const cards = (res.result && res.result.data) || [];
      this.setData({ cards });
    } catch (error) {
      this.setData({ cards: [] });
    } finally {
      this.setData({ loadingCards: false });
    }
  },

  calcScrollHeight() {
    try {
      const sys = wx.getSystemInfoSync();
      const windowHeight = sys.windowHeight || 667;
      const safeAreaBottom = sys.safeArea ? (sys.screenHeight - sys.safeArea.bottom) : 0;
      const tabBarHeight = 50 + safeAreaBottom;

      const query = wx.createSelectorQuery();
      query.select('.hero').boundingClientRect();
      query.select('.section-header').boundingClientRect();
      query.exec((res) => {
        const heroRect = res[0];
        const headerRect = res[1];
        if (!heroRect || !headerRect) return;
        const scrollHeight = windowHeight - heroRect.height - headerRect.height - tabBarHeight;
        this.setData({ contentScrollHeight: Math.max(200, scrollHeight) });
      });
    } catch (e) {}
  },

  onShow() {
    if (this.data.authorized) {
      this.loadHelpers();
    }
  },

  updateSystemInfo() {
    try {
      const sys = wx.getSystemInfoSync();
      const menuButtonRect = wx.getMenuButtonBoundingClientRect();
      const screenWidth = sys.screenWidth || 375;
      const menuCenterPx = menuButtonRect.top + menuButtonRect.height / 2;
      const menuCenterRpx = menuCenterPx * (750 / screenWidth);
      const avatarCenterOffsetRpx = 32;
      const heroPaddingTop = Math.max(20, menuCenterRpx - avatarCenterOffsetRpx);

      this.setData({
        statusBarHeight: sys.statusBarHeight || 44,
        heroPaddingTop
      });
    } catch (e) {
      this.setData({
        statusBarHeight: 44,
        heroPaddingTop: 64
      });
    }
  },

  onHelperTap(event) {
    const id = event.currentTarget.dataset.id;
    if (id === 'add') {
      if (!this.data.authorized) {
        this.requestAuth();
        return;
      }
      this.onInviteTap();
      return;
    }
    this.setData({ selectedHelperId: id });
    this.loadNetworkCards(id);
  },

  requestAuth() {
    wx.showToast({
      title: '请先点击头像/昵称完成授权',
      icon: 'none',
      duration: 2000
    });
  },

  onInviteTap() {
    wx.showShareMenu({ withShareTicket: true });
    wx.showToast({
      title: '邀请功能开发中，请右上角转发',
      icon: 'none'
    });
  },

  onMyProfileTap() {
    wx.navigateTo({
      url: '/pages/my-home/my-home'
    });
  },

  onChooseAvatar(event) {
    const avatarUrl = event.detail.avatarUrl;
    if (avatarUrl) {
      this.saveMyProfile({ avatar: avatarUrl });
    }
  },

  onChooseNickname(event) {
    console.log('chooseNickname event', event.detail);
    const nickname = event.detail.value || event.detail.nickName || '';
    if (nickname) {
      this.saveMyProfile({ nickname });
      return;
    }
    wx.showToast({ title: '请选择或输入一个昵称', icon: 'none' });
  },

  async saveMyProfile(patch) {
    const { myProfile } = this.data;
    const nickname = patch.nickname !== undefined ? patch.nickname : myProfile.nickname;
    const avatar = patch.avatar !== undefined ? patch.avatar : myProfile.avatar;
    const nextProfile = {
      ...myProfile,
      ...patch,
      nickname,
      avatar,
      initial: getInitial(nickname)
    };

    const authorized = Boolean(nextProfile.nickname && nextProfile.avatar);
    this.setData({ myProfile: nextProfile, authorized });

    const fullProfile = { ...nextProfile, serviceTags: [] };
    wx.setStorageSync(STORAGE_KEY, fullProfile);
    try {
      const app = getApp();
      if (app.globalData) app.globalData.userProfile = fullProfile;
    } catch (e) {}

    if (authorized) {
      this.loadHelpers();
    }

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
          const data = {
            _openid: openid,
            nickName: nextProfile.nickname,
            avatarUrl: nextProfile.avatar,
            initial: nextProfile.initial,
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
    } catch (error) {}
  },

  onCardTap(event) {
    const id = event.currentTarget.dataset.id;
    const helperOpenid = this.data.selectedHelperId;
    wx.navigateTo({
      url: `/pages/card-detail/card-detail?id=${id}&helperOpenid=${helperOpenid}&view=network`
    });
  },

  onShareAppMessage() {
    return {
      title: '记事卡｜一起协作，互相帮忙',
      path: '/pages/mutual-help/mutual-help'
    };
  }
});
