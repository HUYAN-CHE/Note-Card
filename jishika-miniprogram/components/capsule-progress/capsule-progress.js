const CANVAS_WIDTH = 230;
const CANVAS_HEIGHT = 60;
const STROKE_WIDTH = 2;
const PROGRESS_WIDTH = 3;

Component({
  properties: {
    label: {
      type: String,
      value: '下拉新建事项'
    },
    progress: {
      type: Number,
      value: 0,
      observer(newVal) {
        if (typeof newVal === 'number') {
          this.drawProgress(newVal);
        }
      }
    }
  },

  data: {
    dragY: 0
  },

  lifetimes: {
    ready() {
      this.measureCanvas(() => {
        this.drawProgress(this.data.progress);
      });
    }
  },

  methods: {
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
    },

    onTapCapsule() {
      this.triggerEvent('trigger', {
        source: 'tap_capsule',
        progress: 1
      });
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
