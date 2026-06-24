const CANVAS_WIDTH = 230;
const CANVAS_HEIGHT = 60;
const STROKE_WIDTH = 2;
const PROGRESS_WIDTH = 3;

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
    }
  },

  data: {
    dragY: 0,
    isReturning: false,
    weekDays: [
      { label: 'S', date: '20' },
      { label: 'S', date: '21' },
      { label: 'M', date: '22' },
      { label: 'T', date: '23', active: true },
      { label: 'W', date: '24' },
      { label: 'T', date: '25' },
      { label: 'F', date: '26' }
    ]
  },

  lifetimes: {
    ready() {
      this.drawProgress(0);
    },

    detached() {
      this.clearProgressTimer();
    }
  },

  methods: {
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

    drawProgress(progress) {
      const safeProgress = Math.max(0, Math.min(1, Number(progress) || 0));
      const ctx = wx.createCanvasContext('capsuleProgress', this);
      const x = 4;
      const y = 4;
      const width = CANVAS_WIDTH - x * 2;
      const height = CANVAS_HEIGHT - y * 2;
      const radius = height / 2;

      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.setLineWidth(STROKE_WIDTH);
      ctx.setStrokeStyle('rgba(255, 255, 255, 0.42)');
      ctx.setLineCap('round');
      drawCapsule(ctx, x, y, width, height, radius);
      ctx.stroke();

      if (safeProgress > 0) {
        ctx.setLineWidth(PROGRESS_WIDTH);
        ctx.setStrokeStyle('rgba(255, 255, 255, 0.98)');
        ctx.setLineCap('round');
        drawCapsuleProgress(ctx, x, y, width, height, radius, safeProgress);
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
}
