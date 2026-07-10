const { ensureDemoCards } = require('../../utils/store');
const { buildSkillLaunchUrl, getSkill } = require('../../services/skill-registry');
const { collections } = require('../../config/env');

const USER_PROFILE_KEY = 'JISHIKA_USER_PROFILE';
const SHOW_DEMO_CARDS = false;

const EMOJIS = {
  requirement: '💊',
  progress: '💊',
  todo: '📝',
  meeting: '🗓️',
  default: '📝'
};

const STATUS_TEXT = {
  draft: '待确认',
  todo: '待确认',
  doing: '进行中',
  done: '已完成'
};

const STATUS_CLASSES = {
  draft: 'status-pending',
  todo: 'status-pending',
  doing: 'status-doing',
  done: 'status-done'
};

const WEEK_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

Page({
  data: {
    cards: [],
    calendarDays: [],
    weekDays: [],
    selectedIndex: 0,
    statusBarHeight: 44,
    reminderEnabled: true,
    refreshing: false,
    bodyScrollTop: 0,
    bodyCanScroll: false,
    showAuthModal: false,
    authProfile: {
      nickname: '',
      avatar: '',
      initial: ''
    }
  },

  onLoad() {
    this.updateSystemInfo();
    this.updateCalendar();
  },

  onShow() {
    this.setData({ refreshing: false, bodyScrollTop: 0 });
    const trigger = this.selectComponent('.home-pull-trigger');
    if (trigger && typeof trigger.resetToIdle === 'function') {
      trigger.resetToIdle(this._lastPullProgress || 0);
    }
    this._lastPullProgress = 0;
    this.loadCards();
    this.checkAuth();

    const today = this.formatDate(new Date());
    if (this.todayDate && this.todayDate !== today) {
      this.updateCalendar();
    }
  },

  checkAuth() {
    const profile = wx.getStorageSync(USER_PROFILE_KEY) || {};
    const authorized = Boolean(profile.nickname && profile.avatar);
    if (!authorized) {
      this.setData({ showAuthModal: true });
    }
  },

  onAuthAvatar(event) {
    const avatarUrl = event.detail.avatarUrl;
    if (!avatarUrl) return;
    this.setData({ 'authProfile.avatar': avatarUrl });
    this.tryFinishAuth();
  },

  onAuthNickname(event) {
    const nickname = event.detail.value;
    if (!nickname) return;
    const initial = nickname.trim().charAt(0);
    this.setData({
      'authProfile.nickname': nickname,
      'authProfile.initial': initial
    });
    this.tryFinishAuth();
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

    this.setData({ showAuthModal: false, authFallback: false });

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
    } catch (error) {}
  },

  closeAuthModal() {
    this.setData({ showAuthModal: false });
  },

  onPreventBubble() {},

  updateSystemInfo() {
    try {
      const sys = wx.getSystemInfoSync();
      this.setData({ statusBarHeight: sys.statusBarHeight || 44 });
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

  buildTestCards() {
    return [];
  },

  async loadCards(selectedDateStr) {
    const app = getApp();
    const launchContext = app.globalData.launchContext;
    const cards = SHOW_DEMO_CARDS ? await ensureDemoCards() : this.buildTestCards();

    try {
      const store = require('../../utils/store');
      const realCards = await store.getCards();
      const allCards = realCards.length ? realCards : cards;

      const selectedDay = this.data.calendarDays[this.data.selectedIndex];
      const endDate = selectedDateStr
        ? new Date(selectedDateStr)
        : (selectedDay ? new Date(selectedDay.date) : new Date());
      const startDate = new Date(endDate);
      startDate.setDate(endDate.getDate() - 6);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      const filteredCards = allCards.filter((card) => {
        if (!card.updatedAt) return false;
        const updated = new Date(card.updatedAt);
        return updated >= startDate && updated <= endDate;
      });

      const decoratedCards = filteredCards.slice(0, 6).map((card) => ({
        ...card,
        emoji: EMOJIS[card.type] || EMOJIS.default,
        displayTitle: card.title || '未命名事项',
        statusText: STATUS_TEXT[card.status] || '待确认',
        statusClass: STATUS_CLASSES[card.status] || 'status-pending',
        deadlineText: this.formatDeadline(card)
      }));

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
    if (card.reminderText) {
      const match = card.reminderText.match(/(\d{1,2}):(\d{2})/);
      if (match) {
        const hour = parseInt(match[1], 10);
        const minute = match[2];
        const period = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
        return `${displayHour}:${minute} ${period}`;
      }
    }
    return '08:30 PM';
  },

  updateDayCounts(cards) {
    const calendarDays = this.data.calendarDays.map((day) => {
      const count = cards.filter((card) => {
        if (!card.updatedAt) return false;
        const updated = new Date(card.updatedAt);
        return this.formatDate(updated) === day.date && card.status !== 'done';
      }).length;
      return { ...day, count };
    });

    this.setData({ calendarDays });
  },

  toggleReminder(event) {
    this.setData({ reminderEnabled: event.detail.value });
  },

  onPreventTouchMove() {},

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
    wx.navigateTo({ url: `/pages/card-detail/card-detail?id=${id}&view=owner` });
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
