const { TYPE_LABELS, buildDraftFromContext } = require('../../services/ai-adapter');
const { getCard, createCardFromDraft, saveCard } = require('../../utils/store');

Page({
  data: {
    card: {},
    keyPointsText: '',
    questionsText: ''
  },

  onLoad(options = {}) {
    this.loadCard(options);
  },

  async loadCard(options = {}) {
    const storedCard = options.id ? await getCard(options.id) : null;
    const pendingDraft = wx.getStorageSync('JISHIKA_PENDING_DRAFT');
    const blankDraft = buildDraftFromContext({
      text: '',
      type: 'requirement',
      source: 'manual'
    });
    const card = storedCard || pendingDraft || blankDraft;

    this.setCard(card);
  },

  setCard(card) {
    this.setData({
      card: {
        ...card,
        type: card.type || 'requirement',
        typeLabel: card.typeLabel || TYPE_LABELS[card.type || 'requirement']
      },
      keyPointsText: (card.keyPoints || []).join('\n'),
      questionsText: (card.questions || []).join('\n')
    });
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({
      [`card.${field}`]: event.detail.value
    });
  },

  onListInput(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    const list = value.split('\n').map((item) => item.trim()).filter(Boolean);

    this.setData({
      [`card.${field}`]: list,
      [`${field}Text`]: value
    });
  },

  async persistCard(extra = {}) {
    const card = {
      ...this.data.card,
      ...extra,
      keyPoints: this.data.keyPointsText.split('\n').map((item) => item.trim()).filter(Boolean),
      questions: this.data.questionsText.split('\n').map((item) => item.trim()).filter(Boolean)
    };

    const saved = card.id ? await saveCard(card) : await createCardFromDraft(card);
    wx.removeStorageSync('JISHIKA_PENDING_DRAFT');
    this.setCard(saved);
    return saved;
  },

  async saveAndPreview() {
    const saved = await this.persistCard({
      status: 'pending_confirm',
      stage: '待客户确认'
    });

    wx.navigateTo({
      url: `/pages/customer-confirm/customer-confirm?id=${saved.id}&preview=1`
    });
  },

  async goProgress() {
    const saved = await this.persistCard({
      status: 'in_progress',
      stage: '服务进度'
    });

    wx.navigateTo({
      url: `/pages/progress/progress?id=${saved.id}`
    });
  },

  onShareAppMessage() {
    const saved = this.data.card || {};
    const path = saved.id
      ? `/pages/customer-confirm/customer-confirm?id=${saved.id}`
      : '/pages/home/home';

    return {
      title: `${saved.projectName || '需求'}｜请确认记事卡`,
      path,
      imageUrl: '/assets/logo.png'
    };
  }
});
