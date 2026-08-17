Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    safeAreaBottom: { type: Number, value: 0 },
    closeOnMask: { type: Boolean, value: true },
    // 右上角 × 关闭按钮：默认不显示（不影响已有页面），需要时传 show-close
    showClose: { type: Boolean, value: false }
  },

  methods: {
    onMaskTap() {
      if (this.data.closeOnMask) {
        this.triggerEvent('close');
      }
    },
    onCloseTap() {
      this.triggerEvent('close');
    },
    noop() {}
  }
});
