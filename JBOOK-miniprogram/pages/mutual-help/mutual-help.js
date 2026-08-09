const { collections } = require('../../config/env');
const { getSafeAreaBottom } = require('../../utils/ui');

// 演示数据开关：true 时互助页注入假人脉与假记事卡，仅用于查看效果（上线前改回 false）
const SHOW_DEMO_CARDS = true;

const DEMO_HELPERS = [
  { id: 'demo-u1', openid: 'demo-u1', type: 'user', name: '李雷', avatar: '', color: '#4caf50', initial: 'L' },
  { id: 'demo-u2', openid: 'demo-u2', type: 'user', name: '韩梅梅', avatar: '', color: '#5c8dff', initial: 'H' }
];

const DEMO_OWN_CARDS = [
  { id: 'demo-c1', title: '周末搬家搭把手', desc: '周六上午，三件大家电需要人抬', creatorName: '李雷', relation: '你的朋友', status: '进行中', creatorId: 'demo-u1', helperOpenid: 'demo-u1' },
  { id: 'demo-c2', title: '求推荐靠谱搬家公司', desc: '预算 500 内，本周内要定', creatorName: '李雷', relation: '你的朋友', status: '进行中', creatorId: 'demo-u1', helperOpenid: 'demo-u1' }
];

const DEMO_NETWORK_CARDS = [
  { id: 'demo-c3', title: '找人一起拼团体检', desc: '公司附近的体检中心，两人成团八折', creatorName: '王芳', relation: '李雷的朋友', status: '进行中', creatorId: 'demo-u3', helperOpenid: 'demo-u1' },
  { id: 'demo-c4', title: '闲置婴儿车转让', desc: '九成新，自提', creatorName: '张伟', relation: '李雷的朋友', status: '进行中', creatorId: 'demo-u4', helperOpenid: 'demo-u1' },
  { id: 'demo-c5', title: '求猫咪寄养三天', desc: '下周五到周日，猫粮我备', creatorName: '陈静', relation: '李雷的朋友', status: '进行中', creatorId: 'demo-u5', helperOpenid: 'demo-u1' }
];
const { uploadAvatar } = require('../../utils/upload-avatar');
const { requestSubscribeCredit } = require('../../utils/subscribe');

// 北京时间日期 key：用于订阅按钮样式按天重置（与首页一致）
function beijingDayKey(ts) {
  if (!ts) return '';
  const d = new Date(new Date(ts).getTime() + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

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
    heroNavTop: 4,
    heroNavHeight: 32,
    heroNavRight: 96,
    subscribed: false,
    unreadCount: 0,
    contentScrollHeight: 500,
    selectedHelperId: '',
    helpers: [{ id: 'add', type: 'add', name: '添加', avatar: '' }],
    ownCards: [],
    networkCards: [],
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

    // 演示模式：直接注入假人脉与假卡，不看云端
    if (SHOW_DEMO_CARDS) {
      const list = [{ id: 'add', type: 'add', name: '添加', avatar: '' }, ...DEMO_HELPERS];
      this.setData({
        helpers: list,
        selectedHelperId: DEMO_HELPERS[0].id,
        ownCards: DEMO_OWN_CARDS,
        networkCards: DEMO_NETWORK_CARDS,
        loadingHelpers: false
      });
      this.calcScrollHeight();
      return;
    }

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
          ownCards: [],
          networkCards: []
        });
      }
    } catch (error) {
      this.setData({
        helpers: [{ id: 'add', type: 'add', name: '添加', avatar: '' }],
        selectedHelperId: '',
        ownCards: [],
        networkCards: []
      });
    } finally {
      this.setData({ loadingHelpers: false });
      this.calcScrollHeight();
    }
  },

  async loadNetworkCards(helperId) {
    if (!helperId || helperId === 'add') return;
    this.setData({ loadingCards: true });

    // 演示模式：按当前选中人脉名注入假卡
    if (SHOW_DEMO_CARDS) {
      const helper = (this.data.helpers || []).find((h) => h.id === helperId);
      const name = (helper && helper.name) || '朋友';
      this.setData({
        ownCards: DEMO_OWN_CARDS.map((c) => ({ ...c, creatorName: name })),
        networkCards: DEMO_NETWORK_CARDS.map((c) => ({ ...c, relation: `${name}的朋友` })),
        loadingCards: false
      });
      return;
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'getNetworkCards',
        data: { helperOpenid: helperId }
      });
      // 新结构：own=TA 自己的卡（一度直达），secondDegree=TA 人脉里我的二度卡
      const result = (res.result && res.result.data) || {};
      this.setData({
        ownCards: result.own || [],
        networkCards: result.secondDegree || []
      });
    } catch (error) {
      this.setData({ ownCards: [], networkCards: [] });
    } finally {
      this.setData({ loadingCards: false });
    }
  },

  calcScrollHeight() {
    try {
      const sys = wx.getSystemInfoSync();
      const windowHeight = sys.windowHeight || 667;
      const safeAreaBottom = getSafeAreaBottom();
      // tab-bar 占位：高 100rpx(≈50px) + 底部间距 24rpx(≈12px)，滚动视窗底边贴 tab 顶
      const tabBarHeight = 62 + safeAreaBottom;

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
    this.loadMyProfile();
    this.loadSubscribeState();
    this.loadUnreadCount();
  },

  // 消息中心未读角标：轻量调用，静默失败不提示
  async loadUnreadCount() {
    const app = getApp();
    if (!app.globalData || !app.globalData.cloudReady || !wx.cloud) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'getMyMessages',
        data: { action: 'unread' }
      });
      if (res.result && res.result.code === 0 && res.result.data) {
        this.setData({ unreadCount: res.result.data.unreadCount || 0 });
      }
    } catch (e) {}
  },

  onMessageTap() {
    wx.navigateTo({
      url: '/pages/messages/messages'
    });
  },

  updateSystemInfo() {
    try {
      const sys = wx.getSystemInfoSync();
      const statusBarHeight = sys.statusBarHeight || 44;
      const menuButtonRect = wx.getMenuButtonBoundingClientRect();
      const screenWidth = sys.screenWidth || 375;
      const menuCenterPx = menuButtonRect.top + menuButtonRect.height / 2;
      const menuCenterRpx = menuCenterPx * (750 / screenWidth);
      const avatarCenterOffsetRpx = 32;
      const heroPaddingTop = Math.max(20, menuCenterRpx - avatarCenterOffsetRpx);

      // 订阅胶囊位置（与首页一致：贴齐微信胶囊左缘）
      let heroNavTop = 4;
      let heroNavHeight = 32;
      let heroNavRight = 96;
      heroNavTop = Math.max((menuButtonRect.top || statusBarHeight + 4) - statusBarHeight, 0);
      heroNavHeight = menuButtonRect.height || 32;
      if (menuButtonRect.left && screenWidth) {
        heroNavRight = screenWidth - menuButtonRect.left + 8;
      }

      this.setData({
        statusBarHeight,
        heroPaddingTop,
        heroNavTop,
        heroNavHeight,
        heroNavRight
      });
    } catch (e) {
      this.setData({
        statusBarHeight: 44,
        heroPaddingTop: 64
      });
    }
  },

  async onSubscribeTap() {
    const data = await requestSubscribeCredit({ source: 'button' });
    if (data) {
      this.setData({ subscribed: true });
      wx.showToast({ title: '订阅成功', icon: 'success' });
    } else {
      wx.showToast({ title: '未完成订阅', icon: 'none' });
    }
  },

  // 订阅按钮状态：按天重置（只有今天授权过才显示「已订阅」，引导每天补额度）
  async loadSubscribeState() {
    const app = getApp();
    if (!app.globalData || !app.globalData.cloudReady || !wx.cloud) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'subscribeReminder',
        data: { action: 'get' }
      });
      if (res.result && res.result.code === 0 && res.result.data) {
        const data = res.result.data;
        this.setData({
          subscribed: data.count > 0 && beijingDayKey(data.lastSubscribedAt) === beijingDayKey(Date.now())
        });
      }
    } catch (e) {}
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

  async onChooseAvatar(event) {
    const tempUrl = event.detail.avatarUrl;
    if (!tempUrl) return;
    // chooseAvatar 返回临时路径（重启即失效），先上传云存储换 fileID 再保存；
    // 上传失败置空走首字母兜底——http://tmp 临时路径在其他用户设备上加载不了，写库即裂图
    const fileID = await uploadAvatar(tempUrl);
    this.saveMyProfile({ avatar: fileID || '' });
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

  onNicknameInput(event) {
    const nickname = event.detail.value || '';
    if (nickname.trim()) {
      this.saveMyProfile({ nickname: nickname.trim() });
    }
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
          // 注意：_openid 是系统保留字段不允许写入，add 时云库自动填充
          // 防御：历史本地缓存可能残留 http://tmp 临时头像路径，不写库（其他设备加载不了）
          const safeAvatar = nextProfile.avatar && nextProfile.avatar.indexOf('http://tmp') !== 0
            ? nextProfile.avatar
            : '';
          const data = {
            nickName: nextProfile.nickname,
            avatarUrl: safeAvatar,
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
    const section = event.currentTarget.dataset.section;
    // own 段是 TA 本人的卡（我的一度）：申请一步直达卡主，不带引荐人
    // network 段是二度卡：维持引荐制，带 helperOpenid（中间人）+ helperName（引荐引导文案用）
    let helperParam = '';
    if (section !== 'own') {
      const helper = (this.data.helpers || []).find((h) => h.id === this.data.selectedHelperId);
      const helperName = (helper && helper.name) || '';
      helperParam = `&helperOpenid=${this.data.selectedHelperId}&helperName=${encodeURIComponent(helperName)}`;
    }
    wx.navigateTo({
      url: `/pages/card-detail/card-detail?id=${id}${helperParam}&view=network`
    });
  },

  onShareAppMessage() {
    return {
      title: '记事卡｜一起协作，互相帮忙',
      path: '/pages/mutual-help/mutual-help'
    };
  }
});
