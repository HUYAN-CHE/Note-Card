Component({
  properties: {
    visible: { type: Boolean, value: false },
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    safeAreaBottom: { type: Number, value: 0 },
    closeOnMask: { type: Boolean, value: true }
  },

  methods: {
    onMaskTap() {
      if (this.data.closeOnMask) {
        this.triggerEvent('close');
      }
    },
    noop() {}
  }
});
