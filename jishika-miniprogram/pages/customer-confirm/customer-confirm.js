const { getCard, updateCard } = require('../../utils/store');

Page({
  data: {
    card: {},
    supplement: ''
  },

  onLoad(options = {}) {
    this.cardId = options.id;
    this.loadCard();
  },

  async loadCard() {
    const card = await getCard(this.cardId);
    this.setData({
      card: card ? normalizeCard(card) : {}
    });
  },

  onSupplementInput(event) {
    this.setData({
      supplement: event.detail.value
    });
  },

  async confirmCard() {
    const updated = await updateCard(this.cardId, {
      status: 'confirmed',
      stage: '服务进度',
      customerSupplement: this.data.supplement,
      confirmedAt: Date.now()
    });

    if (!updated) return;

    wx.showToast({
      title: '已确认',
      icon: 'success'
    });

    setTimeout(() => {
      wx.redirectTo({
        url: `/pages/progress/progress?id=${updated.id}&role=customer`
      });
    }, 600);
  },

  async submitSupplement() {
    if (!this.data.supplement.trim()) {
      wx.showToast({
        title: '请先填写补充内容',
        icon: 'none'
      });
      return;
    }

    await updateCard(this.cardId, {
      status: 'needs_merchant_review',
      stage: '客户已补充',
      customerSupplement: this.data.supplement
    });

    wx.showToast({
      title: '已提交补充',
      icon: 'success'
    });

    this.loadCard();
  }
});

function normalizeCard(card) {
  return {
    ...card,
    keyPoints: card.keyPoints || [],
    questions: card.questions || []
  };
}
