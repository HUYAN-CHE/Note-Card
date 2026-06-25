const CANVAS_WIDTH = 230;
const CANVAS_HEIGHT = 60;
const STROKE_WIDTH = 2;
const PROGRESS_WIDTH = 3;
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
    label: {
      type: String,
      value: '下拉新建事项'
    },
    threshold: {
      type: Number,
      value: 150
    },
    maxDrag: {
      type: Number,
      value: 184
    },
    triggerOnReach: {
      type: Boolean,
      value: true
    },
    vibrate: {
      type: Boolean,
      value: true
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
    dragY: 0,
    isReturning: false,
    calendarItems: [],
    activeIndex: DAY_RANGE,
    trackX: 0,
    isSnapping: false,
    heroHeight: 0
  },

  lifetimes: {
    ready() {
      this.measureCanvas(() => {
        this.drawProgress(0);
      });
      wx.nextTick(() => {
        this.measureHeroHeight();
        this._initialized = true;
        this.setSelectedIndex(this.data.selectedIndex, false);
      });
    },

    detached() {
      this.clearProgressTimer();
    }
  },

  pageLifetimes: {
    show() {
      // 从新建页返回时直接硬复位，避免白卡从下拉位置弹回的动画
      this._startY = null;
      this._lastProgress = 0;
      this._triggered = false;
      this.clearProgressTimer();
      this.setData({ dragY: 0, isReturning: false });
      this.drawProgress(0);
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
    },

    onTouchStart(event) {
      if (!event.touches || !event.touches.length) return;

      this.clearProgressTimer();
      this._startY = event.touches[0].clientY;
      this._lastProgress = Math.min(1, this.data.dragY / this.properties.threshold);

      this.setData({
        isReturning: false
      });
    },

    onTouchMove(event) {
      if (!event.touches || !event.touches.length || typeof this._startY !== 'number') return;

      const distance = Math.max(0, event.touches[0].clientY - this._startY);
      const dragY = Math.min(this.properties.maxDrag, distance);
      const progress = Math.min(1, dragY / this.properties.threshold);

      this._lastProgress = progress;
      this.setData({ dragY });
      this.drawProgress(progress);

      if (progress >= 1 && this.properties.triggerOnReach) {
        this.fireTrigger();
      }
    },

    onTouchEnd() {
      if (this._triggered) return;

      if (this._lastProgress >= 1) {
        this.fireTrigger();
        return;
      }

      this.resetToIdle(this._lastProgress || 0);
    },

    onTapCapsule() {
      this.triggerEvent('trigger', {
        source: 'tap_capsule',
        progress: 1
      });
    },

    fireTrigger() {
      if (this._triggered) return;

      this._triggered = true;
      this.drawProgress(1);

      if (this.properties.vibrate && wx.vibrateShort) {
        wx.vibrateShort({ type: 'light' });
      }

      this.triggerEvent('trigger', {
        source: 'pull_create',
        progress: 1
      });

      setTimeout(() => {
        this.resetToIdle(1);
      }, 180);
    },

    resetToIdle(fromProgress = 0) {
      this._startY = null;
      this._lastProgress = 0;
      this._triggered = false;

      this.setData({
        dragY: 0,
        isReturning: true
      });

      this.animateProgressBack(fromProgress);
    },

    animateProgressBack(fromProgress) {
      this.clearProgressTimer();

      if (!fromProgress) {
        this.drawProgress(0);
        return;
      }

      const start = Date.now();
      const duration = 260;

      this._progressTimer = setInterval(() => {
        const elapsed = Date.now() - start;
        const ratio = Math.min(1, elapsed / duration);
        const eased = 1 - Math.pow(1 - ratio, 3);
        const progress = fromProgress * (1 - eased);

        this.drawProgress(progress);

        if (ratio >= 1) {
          this.clearProgressTimer();
          this.drawProgress(0);
        }
      }, 16);
    },

    clearProgressTimer() {
      if (this._progressTimer) {
        clearInterval(this._progressTimer);
        this._progressTimer = null;
      }
    },

    measureCanvas(callback) {
      this.createSelectorQuery()
        .select('.capsule-canvas')
        .boundingClientRect((rect) => {
          this._canvasWidth = rect ? rect.width : CANVAS_WIDTH;
          this._canvasHeight = rect ? rect.height : CANVAS_HEIGHT;
          if (typeof callback === 'function') {
            callback();
          }
        })
        .exec();
    },

    drawProgress(progress) {
      const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
      const canvasWidth = this._canvasWidth || CANVAS_WIDTH;
      const canvasHeight = this._canvasHeight || CANVAS_HEIGHT;
      const ctx = wx.createCanvasContext('capsuleProgress', this);
      const inset = 4 * (canvasWidth / CANVAS_WIDTH);
      const width = canvasWidth - inset * 2;
      const height = canvasHeight - inset * 2;
      const radius = height / 2;

      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      ctx.setLineWidth(STROKE_WIDTH * (canvasWidth / CANVAS_WIDTH));
      ctx.setStrokeStyle('rgba(255, 255, 255, 0.42)');
      ctx.setLineCap('round');
      drawCapsule(ctx, inset, inset, width, height, radius);
      ctx.stroke();

      if (safeProgress > 0) {
        ctx.setLineWidth(PROGRESS_WIDTH * (canvasWidth / CANVAS_WIDTH));
        ctx.setStrokeStyle('rgba(255, 255, 255, 0.98)');
        ctx.setLineCap('round');
        drawCapsuleProgress(ctx, inset, inset, width, height, radius, safeProgress);
        ctx.stroke();
      }

      ctx.draw();
    }
  }
});

function drawCapsule(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.arc(x + width - radius, y + radius, radius, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + radius, y + height);
  ctx.arc(x + radius, y + radius, radius, Math.PI / 2, Math.PI * 1.5);
  ctx.closePath();
}

function drawCapsuleProgress(ctx, x, y, width, height, radius, progress) {
  const topLength = width - radius * 2;
  const arcLength = Math.PI * radius;
  const segments = [
    {
      type: 'line',
      length: topLength,
      from: [x + radius, y],
      to: [x + width - radius, y]
    },
    {
      type: 'arc',
      length: arcLength,
      center: [x + width - radius, y + radius],
      start: -Math.PI / 2,
      end: Math.PI / 2
    },
    {
      type: 'line',
      length: topLength,
      from: [x + width - radius, y + height],
      to: [x + radius, y + height]
    },
    {
      type: 'arc',
      length: arcLength,
      center: [x + radius, y + radius],
      start: Math.PI / 2,
      end: Math.PI * 1.5
    }
  ];

  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  let remaining = totalLength * progress;

  ctx.beginPath();
  ctx.moveTo(x + radius, y);

  for (let index = 0; index < segments.length; index += 1) {
    if (remaining <= 0) break;

    const segment = segments[index];
    const ratio = Math.min(1, remaining / segment.length);

    if (segment.type === 'line') {
      const [fromX, fromY] = segment.from;
      const [toX, toY] = segment.to;
      ctx.lineTo(
        fromX + (toX - fromX) * ratio,
        fromY + (toY - fromY) * ratio
      );
    } else {
      const [centerX, centerY] = segment.center;
      const arcEnd = segment.start + (segment.end - segment.start) * ratio;
      ctx.arc(centerX, centerY, radius, segment.start, arcEnd);
    }

    remaining -= segment.length;
  }

  ctx.stroke();
}
