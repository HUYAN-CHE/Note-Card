const { getCards } = require('../../utils/store');
const { collections } = require('../../config/env');

const DEFAULT_USER = {
  nickname: '',
  intro: '',
  avatar: '',
  initial: ''
};

const DEFAULT_TAGS = ['官网设计', '品牌梳理', '视觉系统'];

const STORAGE_KEY = 'JISHIKA_USER_PROFILE';

Page({
  data: {
    statusBarHeight: 44,
    heroPaddingTop: 64,
    user: { ...DEFAULT_USER },
    serviceTags: [...DEFAULT_TAGS],
    activeTab: 'mine',
    cards: [],
    allCards: [],
    loading: false,
    isEditing: false,
    editForm: {
      nickname: '',
      intro: '',
      avatar: '',
      initial: '我',
      tagsText: ''
    }
  },

  onLoad() {
    this.updateSystemInfo();
    this.loadUserProfile();
    this.loadCards();
  },

  updateSystemInfo() {
    try {
      const sys = wx.getSystemInfoSync();
      const menuButtonRect = wx.getMenuButtonBoundingClientRect();
      const screenWidth = sys.screenWidth || 375;
      const menuCenterPx = menuButtonRect.top + menuButtonRect.height / 2;
      const menuCenterRpx = menuCenterPx * (750 / screenWidth);
      const heroPaddingTop = Math.max(20, menuCenterRpx - 60);

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

  async loadUserProfile() {
    // 1. 先读全局缓存 / 本地缓存
    const app = getApp();
    const globalProfile = app.globalData && app.globalData.userProfile;
    const local = wx.getStorageSync(STORAGE_KEY);
    const cached = globalProfile || local;

    let user = cached && (cached.nickname || cached.avatar)
      ? {
          nickname: cached.nickname || '',
          intro: cached.intro || '',
          avatar: cached.avatar || '',
          initial: cached.initial || this.getInitial(cached.nickname)
        }
      : { ...DEFAULT_USER };
    let tags = (cached && cached.serviceTags) ? cached.serviceTags : [...DEFAULT_TAGS];

    // 2. 云开发可用时从 users 集合拉取最新
    try {
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const openid = app.globalData.openid || wx.getStorageSync('JISHIKA_OPENID');
        if (openid) {
          const res = await wx.cloud.database()
            .collection(collections.users)
            .where({ openid })
            .limit(1)
            .get();
          const cloudUser = res.data && res.data[0];
          if (cloudUser) {
            user = {
              nickname: cloudUser.nickName || user.nickname,
              intro: cloudUser.intro || user.intro,
              avatar: cloudUser.avatarUrl || user.avatar,
              initial: cloudUser.initial || user.initial
            };
            tags = cloudUser.tags || tags;
            const profile = { ...user, serviceTags: tags };
            wx.setStorageSync(STORAGE_KEY, profile);
            app.globalData.userProfile = profile;
          }
        }
      }
    } catch (error) {
      // 忽略云端读取失败
    }

    this.setData({
      user: { ...user, initial: user.initial || this.getInitial(user.nickname) },
      serviceTags: tags
    });
  },

  async loadCards() {
    this.setData({ loading: true });

    try {
      const allCards = await getCards();
      this.setData({ allCards }, () => {
        this.filterCards();
      });
    } catch (error) {
      this.setData({ cards: [] });
    } finally {
      this.setData({ loading: false });
    }
  },

  filterCards() {
    const { activeTab, allCards } = this.data;
    const openid = this.getCurrentOpenid();

    const cards = allCards.filter((card) => {
      if (activeTab === 'mine') {
        return card.creatorId === openid || (!card.creatorId && !openid);
      }
      return (card.helperIds || []).includes(openid);
    });

    this.setData({ cards });
  },

  getCurrentOpenid() {
    try {
      const app = getApp();
      return (app.globalData && app.globalData.openid) || '';
    } catch (error) {
      return '';
    }
  },

  switchTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (tab === this.data.activeTab) return;
    this.setData({ activeTab: tab }, () => {
      this.filterCards();
    });
  },

  startEdit() {
    const { user, serviceTags } = this.data;
    this.setData({
      isEditing: true,
      editForm: {
        nickname: user.nickname,
        intro: user.intro,
        avatar: user.avatar,
        initial: user.initial || this.getInitial(user.nickname),
        tagsText: serviceTags.join(' ')
      }
    });
  },

  cancelEdit() {
    this.setData({ isEditing: false });
  },

  onChooseAvatar(event) {
    const avatarUrl = event.detail.avatarUrl;
    this.setData({
      'editForm.avatar': avatarUrl,
      'editForm.initial': ''
    });
  },

  onChooseNickname(event) {
    const nickname = event.detail.value;
    this.setData({
      'editForm.nickname': nickname,
      'editForm.initial': this.getInitial(nickname)
    });
  },

  onTagsInput(event) {
    this.setData({ 'editForm.tagsText': event.detail.value });
  },

  onIntroInput(event) {
    this.setData({ 'editForm.intro': event.detail.value });
  },

  getInitial(name) {
    if (!name) return '';
    return name.trim().charAt(0);
  },

  async saveProfile() {
    const { editForm } = this.data;
    const nickname = editForm.nickname.trim() || '我';
    const intro = editForm.intro.trim();
    const avatar = editForm.avatar;
    const serviceTags = editForm.tagsText
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const user = {
      nickname,
      intro,
      avatar,
      initial: this.getInitial(nickname)
    };

    // 本地缓存 + 全局缓存
    const profile = { ...user, serviceTags };
    wx.setStorageSync(STORAGE_KEY, profile);
    try {
      const app = getApp();
      if (app.globalData) app.globalData.userProfile = profile;
    } catch (e) {}

    // 同步到 users 集合
    try {
      const app = getApp();
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const openid = app.globalData.openid || wx.getStorageSync('JISHIKA_OPENID');
        if (openid) {
          const db = wx.cloud.database();
          const res = await db.collection(collections.users)
            .where({ openid })
            .limit(1)
            .get();
          const data = {
            openid,
            nickName: nickname,
            avatarUrl: avatar,
            intro,
            initial: user.initial,
            tags: serviceTags,
            color: this.data.user.color || '#00c853',
            updatedAt: Date.now()
          };

          if (res.data && res.data[0] && res.data[0]._id) {
            await db.collection(collections.users)
              .doc(res.data[0]._id)
              .update({ data });
          } else {
            await db.collection(collections.users).add({
              data: { ...data, createdAt: Date.now() }
            });
          }
        }
      }
    } catch (error) {
      // 云端同步失败不影响本地保存
    }

    this.setData({
      user,
      serviceTags,
      isEditing: false
    });
  },

  openCard(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/card-detail/card-detail?id=${id}`
    });
  },

  onShareAppMessage() {
    return {
      title: '记事卡｜我的主页',
      path: '/pages/my-home/my-home'
    };
  }
});
