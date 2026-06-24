const { ensureDemoCards } = require('../../utils/store');
const { buildSkillLaunchUrl, getSkill } = require('../../services/skill-registry');

Page({
  data: {
    cards: [],
    todoCount: 0,
    todoTitle: '暂无必须处理的事项',
    launchHint: '',
    storeMode: 'local',
    storeModeLabel: '本地'
  },

  onShow() {
    this.loadCards();
  },

  async loadCards() {
    const app = getApp();
    const launchContext = app.globalData.launchContext;
    const cards = await ensureDemoCards();
    const activeCards = cards.filter((card) => card.status !== 'completed');

    this.setData({
      cards: cards.slice(0, 6),
      todoCount: activeCards.length,
      todoTitle: activeCards.length ? '还有事项需要推进' : '暂无必须处理的事项',
      launchHint: launchContext && !launchContext.consumed ? buildLaunchHint(launchContext) : '',
      storeMode: app.globalData.storeMode || 'local',
      storeModeLabel: app.globalData.storeMode === 'cloud' ? '云端' : '本地'
    });
  },

  goIntake() {
    wx.navigateTo({
      url: '/pages/intake/intake'
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

  goProfile() {
    wx.navigateTo({
      url: '/pages/profile-card/profile-card'
    });
  },

  newBlankCard() {
    wx.removeStorageSync('JISHIKA_PENDING_DRAFT');
    wx.navigateTo({
      url: '/pages/card-edit/card-edit'
    });
  },

  openCard(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/card-edit/card-edit?id=${id}`
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
