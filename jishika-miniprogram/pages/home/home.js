const { ensureDemoCards } = require('../../utils/store');
const { buildSkillLaunchUrl, getSkill } = require('../../services/skill-registry');

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
  pending_confirm: '待确认',
  in_progress: '已确认',
  completed: '已完成'
};

const STATUS_CLASSES = {
  draft: 'status-pending',
  pending_confirm: 'status-pending',
  in_progress: 'status-pending',
  completed: 'status-done'
};

const WEEK_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

Page({
  data: {
    cards: [],
    calendarDays: [],
    weekDays: [],
    selectedIndex: 0,
    statusBarHeight: 44,
    reminderEnabled: true
  },

  onLoad() {
    this.updateSystemInfo();
    this.updateCalendar();
  },

  onShow() {
    this.loadCards();

    const today = this.formatDate(new Date());
    if (this.todayDate && this.todayDate !== today) {
      this.updateCalendar();
    }
  },

  updateSystemInfo() {
    try {
      const sys = wx.getSystemInfoSync();
      this.setData({
        statusBarHeight: sys.statusBarHeight || 44
      });
    } catch (e) {
      // 使用默认值
    }
  },

  updateCalendar() {
    const today = new Date();
    const DAY_COUNT = 7;
    const start = new Date(today);
    start.setDate(today.getDate() - 3);

    const days = [];
    let todayIndex = 3;
    for (let i = 0; i < DAY_COUNT; i += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + i);
      const isToday = this.isSameDay(date, today);
      if (isToday) {
        todayIndex = i;
      }
      days.push({
        date: this.formatDate(date),
        fullDate: `${date.getMonth() + 1}月${date.getDate()}日`,
        week: WEEK_LABELS[date.getDay()],
        day: date.getDate(),
        isToday,
        count: 0
      });
    }

    this.todayDate = this.formatDate(today);

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

    this.setData({
      selectedIndex: index,
      weekDays: this.buildWeekDays(this.data.calendarDays, index)
    });
    this.loadCards();
  },

  async loadCards() {
    const app = getApp();
    const launchContext = app.globalData.launchContext;
    const cards = SHOW_DEMO_CARDS ? await ensureDemoCards() : [];

    const decoratedCards = cards.slice(0, 6).map((card) => ({
      ...card,
      emoji: EMOJIS[card.type] || EMOJIS.default,
      statusText: STATUS_TEXT[card.status] || '待确认',
      statusClass: STATUS_CLASSES[card.status] || 'status-pending',
      deadlineText: this.formatDeadline(card)
    }));

    this.setData({
      cards: decoratedCards,
      launchHint: launchContext && !launchContext.consumed ? buildLaunchHint(launchContext) : ''
    });

    this.updateDayCounts(cards);
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
        return this.formatDate(updated) === day.date && card.status !== 'completed';
      }).length;
      return { ...day, count };
    });

    this.setData({ calendarDays });
  },

  toggleReminder(event) {
    this.setData({ reminderEnabled: event.detail.value });
  },

  onMenuTap() {
    // 菜单入口，保留占位
  },

  onProfileTap() {
    wx.navigateTo({
      url: '/pages/profile-card/profile-card'
    });
  },

  goIntake() {
    wx.navigateTo({
      url: '/pages/intake/intake'
    });
  },

  onPullCreate() {
    wx.navigateTo({
      url: '/pages/intake/intake?source=pull_create&type=requirement'
    });
  },

  openCard(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/card-edit/card-edit?id=${id}`
    });
  },

  newBlankCard() {
    wx.removeStorageSync('JISHIKA_PENDING_DRAFT');
    wx.navigateTo({
      url: '/pages/card-edit/card-edit'
    });
  },

  continueAIContext() {
    const app = getApp();
    const context = app.globalData.launchContext || {};
    app.globalData.launchContext = {
      ...context,
      consumed: true
    };

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
      title: '记事卡｜把客户事记成卡',
      path: '/pages/profile-card/profile-card',
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
