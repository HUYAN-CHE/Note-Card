const { getCard, updateCard } = require('../../utils/store');

Page({
  data: {
    card: {},
    role: 'merchant'
  },

  onLoad(options = {}) {
    this.cardId = options.id;
    this.setData({
      role: options.role || 'merchant'
    });
    this.loadCard();
  },

  async loadCard() {
    const card = await getCard(this.cardId);
    this.setData({
      card: normalizeCard(card)
    });
  },

  async completeNode(event) {
    const nodeId = event.currentTarget.dataset.id;
    const nodes = (this.data.card.progressNodes || []).map((node, index, list) => {
      if (node.id === nodeId) return { ...node, status: 'done' };
      const currentIndex = list.findIndex((item) => item.id === nodeId);
      if (index === currentIndex + 1 && node.status === 'todo') return { ...node, status: 'current' };
      return node;
    });

    await updateCard(this.cardId, {
      progressNodes: nodes,
      status: 'in_progress',
      stage: '服务进度'
    });
    this.loadCard();
  },

  requestReminder() {
    const app = getApp();
    const templateIds = app.globalData.reminderTemplateIds || [];

    if (!templateIds.length || !wx.requestSubscribeMessage) {
      wx.showToast({
        title: '已记录提醒，订阅消息后续接入',
        icon: 'none'
      });
      return;
    }

    wx.requestSubscribeMessage({
      tmplIds: templateIds,
      complete: () => {
        wx.showToast({
          title: '提醒已设置',
          icon: 'success'
        });
      }
    });
  },

  async completeService() {
    await updateCard(this.cardId, {
      status: 'completed',
      stage: '服务完成'
    });

    wx.showToast({
      title: '已完成',
      icon: 'success'
    });

    this.loadCard();
  },

  onShareAppMessage() {
    const card = this.data.card || {};
    return {
      title: `${card.projectName || '服务'}｜查看当前进度`,
      path: `/pages/progress/progress?id=${card.id}&role=customer`,
      imageUrl: '/assets/logo.png'
    };
  }
});

function normalizeCard(card) {
  if (!card) return {};

  const statusMap = {
    done: '已完成',
    current: '当前节点',
    todo: '待推进'
  };

  return {
    ...card,
    progressNodes: (card.progressNodes || []).map((node) => ({
      ...node,
      statusText: statusMap[node.status] || '待推进'
    }))
  };
}
