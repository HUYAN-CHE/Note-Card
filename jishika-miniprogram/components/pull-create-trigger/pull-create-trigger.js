const DAY_RANGE = 15; // 今天左右各 15 天，共 31 天
const SPACER_COUNT = 2;
const DAY_WIDTH_VW = 20; // 一屏 5 个，每个占 20vw

function buildDefaultWeekDays() {
  const today = new Date();
  const days = [];
  for (let i = -DAY_RANGE; i <= DAY_RANGE; i += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const weekDay = date.getDay();
    const label = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][weekDay];
    days.push({
      label,
      date: String(date.getDate()),
      fullDate: `${date.getMonth() + 1}-${date.getDate()}`,
      isToday: i === 0
    });
  }
  return days;
}

function buildCalendarItems(weekDays, activeIndex) {
  const items = weekDays.map((day, i) => ({
    ...day,
    id: day.fullDate || `day-${i}`,
    dateIndex: i,
    active: i === activeIndex
  }));

  return [
    { id: 'spacer-left-1', spacer: true },
    { id: 'spacer-left-2', spacer: true },
    ...items,
    { id: 'spacer-right-1', spacer: true },
    { id: 'spacer-right-2', spacer: true }
  ];
}

Component({
  properties: {
    title: {
      type: String,
      value: '生活由无数的小事组成'
    },
    weekDays: {
      type: Array,
      value: buildDefaultWeekDays(),
      observer() {
        if (this._initialized) {
          this.rebuildCalendarItems();
        }
      }
    },
    selectedIndex: {
      type: Number,
      value: DAY_RANGE,
      observer(newVal) {
        if (typeof newVal === 'number' && this._initialized && newVal !== this.data.activeIndex) {
          this.setSelectedIndex(newVal, false);
        }
      }
    },
    statusBarHeight: {
      type: Number,
      value: 44
    }
  },

  data: {
    calendarItems: [],
    activeIndex: DAY_RANGE,
    trackX: 0,
    isSnapping: false,
    heroHeight: 0
  },

  lifetimes: {
    ready() {
      wx.nextTick(() => {
        this.measureHeroHeight();
        this._initialized = true;
        this.setSelectedIndex(this.data.selectedIndex, false);
      });
    }
  },

  pageLifetimes: {
    show() {
      this.measureHeroHeight();
    }
  },

  methods: {
    measureHeroHeight() {
      this.createSelectorQuery()
        .select('.pull-hero')
        .boundingClientRect((rect) => {
          const heroHeight = rect ? rect.height : 0;
          this.setData({ heroHeight });
        })
        .exec();
    },

    getTrackXForIndex(index) {
      return -index * DAY_WIDTH_VW;
    },

    clampTrackX(trackX) {
      const maxIndex = this.data.weekDays.length - 1;
      const minX = this.getTrackXForIndex(maxIndex);
      const maxX = this.getTrackXForIndex(0);
      return Math.max(minX, Math.min(maxX, trackX));
    },

    rebuildCalendarItems() {
      const activeIndex = this.data.activeIndex;
      const calendarItems = buildCalendarItems(this.data.weekDays, activeIndex);
      this.setData({ calendarItems });
    },

    setSelectedIndex(index, emitEvent = true) {
      const maxIndex = this.data.weekDays.length - 1;
      const targetIndex = Math.max(0, Math.min(maxIndex, index));
      const trackX = this.getTrackXForIndex(targetIndex);

      const weekDays = this.data.weekDays.map((day, i) => ({
        ...day,
        active: i === targetIndex
      }));

      const calendarItems = buildCalendarItems(weekDays, targetIndex);

      this.setData({
        selectedIndex: targetIndex,
        activeIndex: targetIndex,
        trackX,
        isSnapping: true,
        weekDays,
        calendarItems
      });

      if (emitEvent) {
        this.triggerEvent('selectDay', { index: targetIndex });
      }
    },

    onStripTouchStart(event) {
      if (!event.touches || !event.touches.length) return;
      this._stripStartX = event.touches[0].clientX;
      this._stripTrackStartX = this.data.trackX || 0;
      this._isStripDragging = true;
      this.setData({ isSnapping: false });
    },

    onStripTouchMove(event) {
      if (!this._isStripDragging || !event.touches || !event.touches.length) return;

      const deltaX = event.touches[0].clientX - this._stripStartX;
      const windowWidth = wx.getSystemInfoSync().windowWidth || 375;
      const deltaVw = (deltaX / windowWidth) * 100;
      const trackX = this.clampTrackX(this._stripTrackStartX + deltaVw);
      this.setData({ trackX });
    },

    onStripTouchEnd(event) {
      if (!this._isStripDragging) return;
      this._isStripDragging = false;

      const currentTrackX = this.data.trackX || 0;
      const rawIndex = Math.round(-currentTrackX / DAY_WIDTH_VW);
      const currentIndex = this.data.activeIndex;
      let targetIndex = Math.max(0, Math.min(this.data.weekDays.length - 1, rawIndex));

      // 一次最多移动一格
      if (targetIndex > currentIndex + 1) {
        targetIndex = currentIndex + 1;
      } else if (targetIndex < currentIndex - 1) {
        targetIndex = currentIndex - 1;
      }

      this.setSelectedIndex(targetIndex);
    },

    onCalendarTap(event) {
      const targetIndex = Number(event.currentTarget.dataset.index);
      if (Number.isNaN(targetIndex)) return;
      this.setSelectedIndex(targetIndex);
    },

    onHeroTouchMove() {
      // 拦截 hero 区域内的 touchmove，防止冒泡到 sheet 触发下拉或页面滚动
      // 什么都不做，catchtouchmove 会自动阻止冒泡
    }
  }
});
