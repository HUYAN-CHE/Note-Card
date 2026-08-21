const { buildSkillLaunchUrl, getSkill } = require('../../services/skill-registry');
const { collections, reviewMode } = require('../../config/env');
const { resolveThemeIcon } = require('../../utils/theme-icon');
const { requestSubscribeCredit } = require('../../utils/subscribe');
const { uploadAvatar } = require('../../utils/upload-avatar');
const { getSafeAreaBottom } = require('../../utils/ui');
const { listInspireCards, splitInspireColumns } = require('../../services/inspire-cards');

const USER_PROFILE_KEY = 'JISHIKA_USER_PROFILE';
const SHOW_DEMO_CARDS = false;

// 状态为系统判定三态（已过期/提醒中/未设提醒）：deadline 早于今天即过期，不再按 status 豁免
// 统一按北京时间（UTC+8）取「今天」，与云函数口径一致
function isExpired(card) {
  if (!card || !card.deadline) return false;
  const beijingNow = new Date(Date.now() + 8 * 3600 * 1000);
  const today = `${beijingNow.getUTCFullYear()}-${String(beijingNow.getUTCMonth() + 1).padStart(2, '0')}-${String(beijingNow.getUTCDate()).padStart(2, '0')}`;
  return card.deadline < today;
}

// 按卡判定：当前用户 openid 在该卡 reminderSetBy 里才算「提醒中」（存量卡无此字段视为未设置）
function cardStatusView(card, openid) {
  if (isExpired(card)) return { text: '已过期', class: 'status-expired' };
  if (openid && Array.isArray(card.reminderSetBy) && card.reminderSetBy.includes(openid)) {
    return { text: '提醒中', class: 'status-reminding' };
  }
  return { text: '未设提醒', class: 'status-no-remind' };
}

const WEEK_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// 北京时间日期 key：用于订阅按钮样式按天重置
function beijingDayKey(ts) {
  if (!ts) return '';
  const d = new Date(new Date(ts).getTime() + 8 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}

Page({
  data: {
    cards: [],
    calendarDays: [],
    weekDays: [],
    selectedIndex: 0,
    statusBarHeight: 44,
    heroNavTop: 4,
    heroNavHeight: 32,
    heroNavRight: 96,
    reminderEnabled: false,
    homeTab: 'note',
    // 灵感页卡片（真实数据，onShow 从云端加载）；inspireCols 为瀑布流左右两列
    inspireCards: [],
    inspireCols: { left: [], right: [] },
    // 审核版开关：true 时灵感页空态显示中性文案，不暴露会员引导（config/env.js）
    reviewMode: reviewMode,
    // 会员状态：none 未开通 / active 有效期中 / expired 已过期（灵感页空态展示用）
    memberStatus: 'none',
    // 是否已绑定企微私人助理（灵感页空态分流：已连接→纯文案，未连接→引导去会员页）
    hasWecomBound: false,
    refreshing: false,
    // 私聊成卡弹窗：私聊来源草稿卡列表，每天首次进入弹出，可直接设提醒时间
    wecomDrafts: [],
    wecomSheetVisible: false,
    // 今日新增灵感碎片数（弹窗底部汇总行；0 不显示）
    inspireTodayCount: 0,
    // 绑定成功半弹窗：私聊发会员码后回小程序，检测到未绑定→已绑定跳变时弹出
    boundSheetVisible: false,
    safeAreaBottom: 0,
    bodyScrollTop: 0,
    bodyCanScroll: false,
    openedCardId: '',
    showAuthModal: false,
    authProfile: {
      nickname: '',
      avatar: '',
      initial: ''
    }
  },

  onLoad(options) {
    this.updateSystemInfo();
    this.updateCalendar();
    this.setData({ safeAreaBottom: getSafeAreaBottom() });
    // 会员页「查看私聊新卡」跳入：强制弹私聊卡弹窗，不受每日一次限制，也不消耗当日额度
    this._forceWecomSheet = !!(options && options.wecomSheet === '1');
  },

  onShow() {
    this.setData({ refreshing: false, bodyScrollTop: 0 });
    const trigger = this.selectComponent('.home-pull-trigger');
    if (trigger && typeof trigger.resetToIdle === 'function') {
      trigger.resetToIdle(this._lastPullProgress || 0);
    }
    this._lastPullProgress = 0;
    this.loadCards();
    this.loadInspireCards();
    this.loadMembershipStatus();
    this.loadSubscribeState();
    this.checkAuth();
    this.checkWecomDrafts();

    const today = this.formatDate(new Date());
    if (this.todayDate && this.todayDate !== today) {
      this.updateCalendar();
    }
  },

  // 私聊成卡弹窗：每天首次进入检查私聊来源的草稿卡（首页规则不展示无 deadline 的卡，需主动告知）
  async checkWecomDrafts() {
    const force = this._forceWecomSheet;
    this._forceWecomSheet = false;
    const today = this.formatDate(new Date());
    // 会员页主动入口跳入（force）不受每日一次限制；正常进入当天已提示过则跳过
    if (!force && wx.getStorageSync('JISHIKA_WECOM_TIP_DATE') === today) return;
    const app = getApp();
    if (!app.globalData || !app.globalData.cloudReady || !wx.cloud) return;
    const openid = app.globalData.openid || wx.getStorageSync('JISHIKA_OPENID');
    if (!openid) return;
    try {
      const db = wx.cloud.database();
      const res = await db.collection(collections.cards)
        .where({ creatorId: openid, source: 'wecom', status: 'draft' })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      const list = (res.data || []).map((c) => ({
        ...c,
        // WXML 表达式不支持字符串方法调用，日期短格式（08/19）在这里预处理
        deadlineText: c.deadline ? c.deadline.slice(5).replace('-', '/') : ''
      }));
      if (!list.length) {
        if (force) wx.showToast({ title: '暂时没有私聊新卡', icon: 'none' });
        return;
      }
      // 自动提醒才记当日已提示；force 主动查看不消耗当日额度
      if (!force) wx.setStorageSync('JISHIKA_WECOM_TIP_DATE', today);
      // 弹窗底部汇总：今日新增灵感碎片数（走 service 缓存，与 loadInspireCards 共用一次请求）
      let inspireTodayCount = 0;
      try {
        const inspireCards = await listInspireCards();
        inspireTodayCount = inspireCards.reduce((sum, c) => sum + (c.todaySparkCount || 0), 0);
      } catch (e) { /* 汇总行失败不阻塞弹窗 */ }
      this.setData({ wecomDrafts: list, wecomSheetVisible: true, inspireTodayCount });
    } catch (e) {
      console.warn('checkWecomDrafts error', e);
    }
  },

  onWecomSheetClose() {
    this.setData({ wecomSheetVisible: false });
  },

  // 弹窗底部汇总行：关弹窗并切到灵感 tab
  onWecomTipInspire() {
    this.setData({ wecomSheetVisible: false, homeTab: 'inspire' });
  },

  onBoundSheetClose() {
    this.setData({ boundSheetVisible: false });
  },

  // 弹窗内直接设提醒时间：原生日期选择器，选完即写库
  async onSetWecomDeadline(e) {
    const deadline = e.detail.value;
    const docId = e.currentTarget.dataset.docid;
    if (!deadline || !docId) return;
    const list = this.data.wecomDrafts.map((c) => (
      c._id === docId ? { ...c, deadline, deadlineText: deadline.slice(5).replace('-', '/') } : c
    ));
    this.setData({ wecomDrafts: list });
    try {
      await wx.cloud.database().collection(collections.cards)
        .doc(docId)
        .update({ data: { deadline, updatedAt: Date.now() } });
      wx.showToast({ title: '已设置提醒', icon: 'success' });
    } catch (err) {
      console.warn('onSetWecomDeadline error', err);
      wx.showToast({ title: '设置失败，请重试', icon: 'none' });
    }
  },

  async checkAuth() {
    let profile = wx.getStorageSync(USER_PROFILE_KEY) || {};
    let nickname = profile.nickname && String(profile.nickname).trim();
    let authorized = Boolean(nickname && nickname !== '我' && profile.avatar);

    // 本地无有效授权：尝试从云端 users 表回源（换设备/清缓存后不再「被未授权」）
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

    const safeNickname = nickname === '我' ? '' : nickname;
    this.setData({
      showAuthModal: !authorized,
      authProfile: {
        nickname: safeNickname || '',
        avatar: profile.avatar || '',
        initial: profile.initial || (safeNickname ? safeNickname.charAt(0).toUpperCase() : '')
      }
    });
  },

  // 从云端 users 表读授权信息；无有效记录返回 null
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
    // 上传失败不保留微信临时路径：http://tmp 在其他用户设备上加载不了，写库即裂图，置空走首字母兜底
    this.setData({ 'authProfile.avatar': fileID || '' });
    this.tryFinishAuth();
  },

  onAuthNickname(event) {
    console.log('chooseNickname event', event.detail);
    const nickname = event.detail.value || event.detail.nickName || '';
    if (nickname) {
      this.setNickname(nickname);
      return;
    }
    wx.showToast({ title: '请选择或输入一个昵称', icon: 'none' });
  },

  onAuthNicknameInput(event) {
    const nickname = event.detail.value || '';
    this.setData({ 'authProfile.nickname': nickname });
    if (nickname.trim()) {
      this.setNickname(nickname.trim());
    }
  },

  setNickname(nickname) {
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

  async finishAuth(profile) {
    function cleanNickname(name) {
      if (!name || String(name).trim() === '我') return '';
      return String(name).trim();
    }

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

    this.setData({ showAuthModal: false, authFallback: false }, () => {
      this.loadCards();
    });

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
      // 写云端失败：本地仍可用，但换设备/清缓存后会「被未授权」，提示用户稍后重试
      console.error('[finishAuth] 授权信息同步云端失败', error);
      wx.showToast({ title: '授权信息同步失败，请稍后重试', icon: 'none' });
    }
  },

  closeAuthModal() {
    this.setData({ showAuthModal: false });
  },

  onPreventBubble() {},

  updateSystemInfo() {
    try {
      const sys = wx.getSystemInfoSync();
      const statusBarHeight = sys.statusBarHeight || 44;
      let heroNavTop = 4;
      let heroNavHeight = 32;
      let heroNavRight = 96;
      try {
        const rect = wx.getMenuButtonBoundingClientRect();
        heroNavTop = Math.max((rect.top || statusBarHeight + 4) - statusBarHeight, 0);
        heroNavHeight = rect.height || 32;
        if (rect.left && sys.screenWidth) {
          // 按钮右缘贴齐胶囊左缘，留出 8px 间隔
          heroNavRight = sys.screenWidth - rect.left + 8;
        }
      } catch (e) {}
      this.setData({ statusBarHeight, heroNavTop, heroNavHeight, heroNavRight });
    } catch (e) {}
  },

  updateCalendar() {
    const today = new Date();
    const DAY_RANGE = 15;
    const DAY_COUNT = DAY_RANGE * 2 + 1;
    const start = new Date(today);
    start.setDate(today.getDate() - DAY_RANGE);

    const days = [];
    let todayIndex = DAY_RANGE;
    for (let i = 0; i < DAY_COUNT; i += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const isToday = this.isSameDay(date, today);
      if (isToday) todayIndex = i;
      days.push({
        date: this.formatDate(date),
        fullDate: `${date.getMonth() + 1}-${date.getDate()}`,
        week: WEEK_LABELS[date.getDay()],
        day: date.getDate(),
        isToday,
        count: 0
      });
    }

    this.todayDate = this.formatDate(today);
    this._lastCardRange = null;

    this.setData({
      calendarDays: days,
      weekDays: this.buildWeekDays(days, todayIndex),
      selectedIndex: todayIndex
    });
  },

  buildWeekDays(days, selectedIndex) {
    return days.map((day, index) => ({
      label: day.week,
      date: String(day.day),
      fullDate: day.fullDate,
      isToday: day.isToday,
      active: index === selectedIndex
    }));
  },

  formatDate(date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
  },

  selectDay(event) {
    const index = Number(event.detail && event.detail.index);
    if (Number.isNaN(index)) return;

    const selectedDay = this.data.calendarDays[index];
    if (!selectedDay) return;

    const rangeKey = this.formatDate(selectedDay);

    this.setData({
      selectedIndex: index,
      weekDays: this.buildWeekDays(this.data.calendarDays, index)
    });

    if (this._lastCardRange !== rangeKey) {
      this._lastCardRange = rangeKey;
      this.loadCards(selectedDay.date);
    }
  },

  // 演示数据：SHOW_DEMO_CARDS 开启且首页无真实卡时展示（仅本地，不写云库）
  buildTestCards() {
    if (!SHOW_DEMO_CARDS) return [];
    const store = require('../../utils/store');
    const openid = (store.getCurrentOpenid && store.getCurrentOpenid()) || '';
    const now = Date.now();
    const day = 24 * 3600 * 1000;
    const fmt = (t) => {
      const d = new Date(t);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    return [
      { id: 'demo-1', title: '周六拼车去露营', desc: '老地方集合，装备我带', deadline: fmt(now + 3 * day), updatedAt: now, reminderSetBy: [openid], status: 'todo' },
      { id: 'demo-2', title: '给妈妈预约体检', desc: '电话确认过套餐内容', deadline: fmt(now + 6 * day), updatedAt: now - day, reminderSetBy: [], status: 'todo' },
      { id: 'demo-3', title: '还图书馆的书', desc: '两本，别超期', deadline: fmt(now - day), updatedAt: now - 2 * day, reminderSetBy: [], status: 'todo' },
      { id: 'demo-4', title: '周五团建接龙报名', desc: '截止周五中午', deadline: fmt(now + day), updatedAt: now - 3600 * 1000, reminderSetBy: [openid], status: 'todo' }
    ];
  },

  async loadCards(selectedDateStr) {
    const app = getApp();
    const launchContext = app.globalData.launchContext;

    // 未授权时不展示任何事项
    const profile = wx.getStorageSync(USER_PROFILE_KEY) || {};
    const nickname = profile.nickname && String(profile.nickname).trim();
    const authorized = Boolean(nickname && nickname !== '我' && profile.avatar);
    if (!authorized) {
      this.setData({ cards: [] }, () => {
        this.updateDayCounts([]);
        wx.nextTick(() => this.measureBodyCanScroll());
      });
      return;
    }

    const cards = this.buildTestCards();

    try {
      const store = require('../../utils/store');
      const realCards = await store.getCards();
      // 演示模式：demo 卡追加在真实卡后一起展示；正式模式只用真实卡
      const allCards = SHOW_DEMO_CARDS ? [...realCards, ...cards] : (realCards.length ? realCards : cards);
      // 状态三态按卡判定：云端就绪时 getCards 直查云库返回全字段（含 reminderSetBy）；
      // 本地缓存兜底缺该字段时判空安全，按「未设提醒」显示
      const openid = store.getCurrentOpenid();

      const selectedDay = this.data.calendarDays[this.data.selectedIndex];
      // 展示口径：当前选择日期（含）往后 7 天内到期的卡；已过期（deadline 早于选择日期）不出现；不限张数
      const pad2 = (n) => String(n).padStart(2, '0');
      const fmtD = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const baseDate = selectedDateStr
        ? new Date(selectedDateStr)
        : (selectedDay ? new Date(selectedDay.date) : new Date());
      const endDate = new Date(baseDate);
      endDate.setDate(baseDate.getDate() + 7);
      const baseStr = fmtD(baseDate);
      const endStr = fmtD(endDate);

      const filteredCards = allCards.filter((card) => {
        if (!card.deadline) return false;
        return card.deadline >= baseStr && card.deadline <= endStr;
      });

      const decoratedCards = filteredCards.map((card) => {
        const statusView = cardStatusView(card, openid);
        return {
          ...card,
          icon: resolveThemeIcon(card),
          displayTitle: this.truncateTitle(card.title),
          statusText: statusView.text,
          statusClass: statusView.class,
          deadlineText: this.formatDeadline(card)
        };
      });

      this.setData({
        cards: decoratedCards,
        launchHint: launchContext && !launchContext.consumed ? buildLaunchHint(launchContext) : ''
      }, () => {
        wx.nextTick(() => {
          this.measureBodyCanScroll();
        });
      });

      this.updateDayCounts(allCards);
    } catch (e) {
      console.error('loadCards error', e);
    }
  },

  onBodyScroll(event) {
    const scrollTop = event.detail && typeof event.detail.scrollTop === 'number' ? event.detail.scrollTop : 0;
    this.setData({ bodyScrollTop: scrollTop });
  },

  // 卡片标题超过 10 字截断加省略号
  truncateTitle(title) {
    const text = (title || '').trim() || '未命名事项';
    return text.length > 10 ? text.slice(0, 10) + '…' : text;
  },

  measureBodyCanScroll() {
    if (!this.data.cards.length) {
      this.setData({ bodyCanScroll: false });
      return;
    }
    this.createSelectorQuery()
      .select('.card-list-scroll')
      .boundingClientRect((containerRect) => {
        if (!containerRect) return;
        this.createSelectorQuery()
          .select('.card-list')
          .boundingClientRect((contentRect) => {
            const canScroll = contentRect ? contentRect.height > containerRect.height : false;
            this.setData({ bodyCanScroll: canScroll });
          })
          .exec();
      })
      .exec();
  },

  formatDeadline(card) {
    return card.deadline || '未设置';
  },

  updateDayCounts(cards) {
    // 日历数字口径：该日期到期的卡数（deadline 归一化为补零格式后比较）
    const pad2 = (n) => String(n).padStart(2, '0');
    const fmtD = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const calendarDays = this.data.calendarDays.map((day) => {
      const dayStr = fmtD(new Date(day.date));
      const count = cards.filter((card) => card.deadline && card.deadline === dayStr).length;
      return { ...day, count };
    });

    this.setData({ calendarDays });
  },

  toggleReminder(event) {
    const enabled = event.detail.value;
    this.setData({ reminderEnabled: enabled });
    // 每次拨动（无论开或关）都累计一次订阅额度，并保存开关状态；
    // source=switch 只加次数，不点亮头部订阅按钮
    this.requestSubscribe({ source: 'switch', reminderEnabled: enabled }, { silent: true });
  },

  // 「临近消息提醒」开关状态（reminderEnabled）回显；卡片状态三态改为按卡判定（reminderSetBy），不再依赖全局订阅状态
  async loadSubscribeState() {
    const app = getApp();
    if (!app.globalData || !app.globalData.cloudReady || !wx.cloud) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'subscribeReminder',
        data: { action: 'get' }
      });
      if (res.result && res.result.code === 0 && res.result.data) {
        this.setData({ reminderEnabled: !!res.result.data.reminderEnabled });
      }
    } catch (e) {}
  },

  // 订阅消息额度累计：配置了模板则先走微信授权弹窗，用户接受才计数；
  // 模板未配置时直接计数。extra 用于顺带保存开关状态等字段。
  async requestSubscribe(extra, options) {
    const silent = options && options.silent;
    const app = getApp();
    if (!app.globalData || !app.globalData.cloudReady || !wx.cloud) {
      if (!silent) {
        wx.showToast({ title: '云开发未就绪', icon: 'none' });
      }
      return;
    }

    const data = await requestSubscribeCredit(extra);
    if (data) {
      if (!silent) {
        wx.showToast({ title: '订阅成功', icon: 'success' });
      }
    } else if (!silent) {
      wx.showToast({ title: '未完成订阅', icon: 'none' });
    }
  },

  onPreventTouchMove() {},

  onHomeTabTap(event) {
    const tab = event.currentTarget.dataset.tab;
    if (tab && tab !== this.data.homeTab) {
      this.setData({ homeTab: tab });
    }
  },

  // 会员状态：灵感页空态区分「会员引导」「待连接助理」「已连接待记录」三种展示
  // 顺带做绑定成功跳变检测：storage 记录上次绑定状态，未绑定→已绑定 时弹半弹窗即时反馈
  //（私聊发会员码后用户回小程序必然经过首页，无需订阅消息额度）
  loadMembershipStatus() {
    if (!wx.cloud) return;
    wx.cloud.callFunction({ name: 'membership', data: { action: 'getStatus' } })
      .then((res) => {
        const d = (res.result && res.result.data) || {};
        const bound = !!d.hasWecomBound;
        const lastBound = wx.getStorageSync('JISHIKA_WECOM_BOUND');
        // 仅在"有记录且从 false 变 true"时弹：避免老用户/未走过绑定流程的用户误弹
        if (bound && lastBound === false) {
          this.setData({ boundSheetVisible: true });
        }
        wx.setStorageSync('JISHIKA_WECOM_BOUND', bound);
        this.setData({
          memberStatus: d.status || 'none',
          hasWecomBound: bound
        });
      })
      .catch(() => {});
  },

  // 灵感页空态「了解会员权益」→ 会员页
  openMember() {
    wx.navigateTo({ url: '/pages/member/member' });
  },

  // 灵感卡：从云端加载（缓存命中则直接用，后台刷新），瀑布流分列（内含相邻不同色着色）
  // 演示模式：注入假灵感卡查看瀑布流效果（demo- 前缀，点击不跳转详情）
  // 灵感卡长按删除：actionSheet 确认后调 inspireCard.delete，刷新列表
  onInspireLongPress(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showActionSheet({
      itemList: ['删除这张灵感卡'],
      success: (res) => {
        if (res.tapIndex !== 0) return;
        wx.cloud.callFunction({ name: 'inspireCard', data: { action: 'delete', id } })
          .then((r) => {
            const result = (r && r.result) || {};
            if (result.code === 0) {
              wx.showToast({ title: '已删除', icon: 'success' });
              this.loadInspireCards();
            } else {
              wx.showToast({ title: result.message || '删除失败', icon: 'none' });
            }
          })
          .catch(() => wx.showToast({ title: '删除失败', icon: 'none' }));
      }
    });
  },

  loadInspireCards() {
    if (SHOW_DEMO_CARDS) {
      const demo = [
        { id: 'demo-i1', title: '把灵感随手记下来', desc: '想到什么发什么，AI 帮你集采成文', tags: ['灵感', 'AI'], color: '#ffd9a8' },
        { id: 'demo-i2', title: '周末去哪玩', desc: '周边露营地合集', tags: ['出行'], color: '#a8ebc5' },
        { id: 'demo-i3', title: '装修避坑清单', desc: '水电验收要点', tags: ['生活', '清单'], color: '#a8d0f0' },
        { id: 'demo-i4', title: '读书记录', desc: '《卡片笔记写作法》摘抄', tags: ['阅读'], color: '#f0c8e0' },
        { id: 'demo-i5', title: '减脂餐搭配', desc: '一周备餐思路', tags: ['健康'], color: '#d9f0a8' },
        { id: 'demo-i6', title: '自驾游路线', desc: '沿海线三天两夜', tags: ['出行', '攻略'], color: '#a8c8f0' },
        { id: 'demo-i7', title: '阳台种菜日记', desc: '小番茄挂果了', tags: ['生活'], color: '#f0e0a8' },
        { id: 'demo-i8', title: '摄影构图笔记', desc: '三分法与引导线', tags: ['摄影', '笔记'], color: '#c8e0f0' },
        { id: 'demo-i9', title: '咖啡冲煮参数', desc: '手冲水温与粉水比', tags: ['咖啡'], color: '#e0c8a8' },
        { id: 'demo-i10', title: '播客清单', desc: '通勤路上听的', tags: ['清单'], color: '#d0a8e8' },
        { id: 'demo-i11', title: '亲子手工创意', desc: '纸箱城堡搭建记', tags: ['亲子'], color: '#a8e0d0' },
        { id: 'demo-i12', title: '跑步训练计划', desc: '十公里进阶八周', tags: ['运动', '计划'], color: '#b8d9f0' }
      ];
      this.setData({ inspireCards: demo, inspireCols: splitInspireColumns(demo) });
      return;
    }
    listInspireCards(true)
      .then((cards) => {
        this.setData({ inspireCards: cards, inspireCols: splitInspireColumns(cards) });
      })
      .catch((e) => console.warn('loadInspireCards error', e));
  },

  // 点击灵感卡，进入可编辑的文章页（带上列表着色，保持视觉连续）
  openInspireDetail(event) {
    const { id, color } = event.currentTarget.dataset;
    if (!id) return;
    // 演示卡不进详情（云端无对应数据）
    if (String(id).indexOf('demo-') === 0) {
      wx.showToast({ title: '演示卡片，仅展示效果', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/inspire-detail/inspire-detail?id=${id}&color=${encodeURIComponent(color || '')}` });
  },

  onMenuTap() {},

  onProfileTap() {
    wx.navigateTo({ url: '/pages/my-home/my-home' });
  },

  goIntake() {
    wx.navigateTo({ url: '/pages/card-import/card-import' });
  },

  onPullCreate() {
    wx.navigateTo({ url: '/pages/card-edit/card-edit?type=requirement' });
  },

  onPullCreatePulling(event) {
    const dy = event.detail && typeof event.detail.dy === 'number' ? event.detail.dy : 0;
    const progress = Math.min(1, Math.max(0, dy / 80));
    this._lastPullProgress = progress;
    const trigger = this.selectComponent('.home-pull-trigger');
    if (trigger && typeof trigger.drawProgress === 'function') {
      trigger.drawProgress(progress);
    }
  },

  onPullCreateClose() {
    const trigger = this.selectComponent('.home-pull-trigger');
    if (trigger && typeof trigger.resetToIdle === 'function') {
      trigger.resetToIdle(this._lastPullProgress || 0);
    }
    this._lastPullProgress = 0;
  },

  onPullCreateFromRefresh() {
    this.setData({ refreshing: true });
    const trigger = this.selectComponent('.home-pull-trigger');
    if (trigger && typeof trigger.drawProgress === 'function') {
      trigger.drawProgress(1);
    }
    wx.navigateTo({ url: '/pages/card-edit/card-edit?type=requirement' });
  },

  openCard(event) {
    const id = event.currentTarget.dataset.id;
    // 已左滑展开时，点击先收起而不是打开
    const index = this.data.cards.findIndex((c) => c.id === id);
    if (index >= 0 && (this.data.cards[index].swipeX || 0) < 0) {
      this.setData({ [`cards[${index}].swipeX`]: 0, openedCardId: '' });
      return;
    }
    wx.navigateTo({ url: `/pages/card-detail/card-detail?id=${id}&view=owner` });
  },

  // ==================== 左滑删除 ====================

  deleteBtnWidthPx() {
    const sys = this.sysInfo || wx.getSystemInfoSync();
    this.sysInfo = sys;
    return 140 * (sys.windowWidth / 750);
  },

  onSwipeStart(event) {
    const { id, index } = event.currentTarget.dataset;
    const maxX = this.deleteBtnWidthPx();
    const baseX = this.data.openedCardId === id ? -maxX : 0;

    // 收起其他已展开的卡
    if (this.data.openedCardId && this.data.openedCardId !== id) {
      const openedIndex = this.data.cards.findIndex((c) => c.id === this.data.openedCardId);
      if (openedIndex >= 0) {
        this.setData({ [`cards[${openedIndex}].swipeX`]: 0, openedCardId: '' });
      }
    }

    this._swipe = {
      id,
      index,
      baseX,
      startX: event.touches[0].clientX,
      startY: event.touches[0].clientY,
      moved: false
    };
  },

  onSwipeMove(event) {
    const s = this._swipe;
    if (!s) return;
    const dx = event.touches[0].clientX - s.startX;
    const dy = event.touches[0].clientY - s.startY;

    if (!s.moved) {
      // 纵向滚动优先，不触发横滑
      if (Math.abs(dy) > Math.abs(dx)) return;
      if (Math.abs(dx) > 6) s.moved = true;
    }
    if (!s.moved) return;

    const maxX = this.deleteBtnWidthPx();
    const x = Math.max(-maxX, Math.min(0, s.baseX + dx));
    this.setData({ [`cards[${s.index}].swipeX`]: x });
  },

  onSwipeEnd() {
    const s = this._swipe;
    this._swipe = null;
    if (!s || !s.moved) return;

    const maxX = this.deleteBtnWidthPx();
    const x = this.data.cards[s.index] ? (this.data.cards[s.index].swipeX || 0) : 0;
    const opened = x < -maxX / 2;
    this.setData({
      [`cards[${s.index}].swipeX`]: opened ? -maxX : 0,
      openedCardId: opened ? s.id : ''
    });
  },

  onDeleteCard(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: '删除记事卡',
      content: '删除后不可恢复，确定删除这张记事卡吗？',
      confirmText: '删除',
      confirmColor: '#e53935',
      success: (res) => {
        if (res.confirm) this.deleteCard(id);
      }
    });
  },

  async deleteCard(id) {
    const app = getApp();
    if (!app.globalData || !app.globalData.cloudReady || !wx.cloud) {
      wx.showToast({ title: '云开发未就绪', icon: 'none' });
      return;
    }

    try {
      const res = await wx.cloud.callFunction({ name: 'deleteCard', data: { cardId: id } });
      if (res.result && res.result.code === 0) {
        this.setData({
          cards: this.data.cards.filter((c) => c.id !== id),
          openedCardId: ''
        });
        wx.showToast({ title: '已删除', icon: 'success' });
      } else {
        wx.showToast({ title: (res.result && res.result.message) || '删除失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  },

  newBlankCard() {
    wx.removeStorageSync('JISHIKA_PENDING_DRAFT');
    wx.navigateTo({ url: '/pages/card-edit/card-edit' });
  },

  continueAIContext() {
    const app = getApp();
    const context = app.globalData.launchContext || {};
    app.globalData.launchContext = { ...context, consumed: true };

    wx.navigateTo({
      url: buildSkillLaunchUrl(context.skillName || 'create_card_from_chat', {
        source: context.source || 'wechat_ai',
        cardType: context.cardType || 'requirement',
        context: context.rawText || ''
      })
    });
  },

  onShareAppMessage() {
    return {
      title: '记事卡｜把一件事说清楚、找对人帮忙',
      path: '/pages/home/home',
      imageUrl: '/assets/logo.png'
    };
  }
});

function buildLaunchHint(context) {
  const skill = getSkill(context.skillName);

  if (skill && context.rawText) {
    return `建议：${skill.title}`;
  }

  if (context.rawText) {
    return `建议整理为${context.cardType === 'todo' ? '群聊待办' : context.cardType === 'progress' ? '服务进度卡' : '需求确认卡'}`;
  }

  return skill ? `建议：${skill.title}` : '可将当前意图整理为记事卡草稿';
}
