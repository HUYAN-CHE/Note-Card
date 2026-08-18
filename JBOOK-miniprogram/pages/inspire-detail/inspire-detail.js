const { getNavInfo, getSafeAreaBottom } = require('../../utils/ui');
const { buildDraftFromContext } = require('../../services/ai-adapter');
const {
  getInspireCard,
  updateInspireCard,
  summarizeInspireCard
} = require('../../services/inspire-cards');

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    // 底部安全区（px）：安卓 env() 多数机型为 0，JS 计算统一兜底
    safeAreaBottom: 12,
    id: '',
    loading: true,
    loadError: '',
    // 编辑态表单（与卡片字段一一对应，keywords 以逗号分隔文本编辑）
    color: '#cfe8fb',
    title: '',
    subtitle: '',
    keywordsText: '',
    article: '',
    status: 'collecting',
    sparks: [],
    dirty: false,
    saving: false,
    summarizing: false
  },

  onLoad(options) {
    const navInfo = getNavInfo();
    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight,
      safeAreaBottom: getSafeAreaBottom()
    });

    // 列表带入的着色优先（展示层按列表顺序循环着色，保证相邻不同色），没有则用卡片自身颜色
    if (options && options.color) {
      try {
        this.navColor = decodeURIComponent(options.color);
      } catch (e) {
        this.navColor = options.color;
      }
      if (this.navColor) this.setData({ color: this.navColor });
    }

    if (options && options.id) {
      this.setData({ id: options.id });
      this.loadDetail();
    } else {
      this.setData({ loading: false, loadError: '缺少卡片参数' });
    }
  },

  loadDetail() {
    this.setData({ loading: true, loadError: '' });
    getInspireCard(this.data.id)
      .then((card) => {
        this.setData({
          loading: false,
          color: this.navColor || card.color || '#cfe8fb',
          title: card.title || '',
          subtitle: card.subtitle || '',
          keywordsText: (card.keywords || []).join('，'),
          article: card.article || '',
          status: card.status === 'exported' ? 'exported' : 'collecting',
          sparks: Array.isArray(card.sparks) ? card.sparks : [],
          dirty: false
        });
      })
      .catch((err) => {
        this.setData({ loading: false, loadError: err.message || '加载失败' });
      });
  },

  // 编辑中返回：拦截并确认丢弃未保存修改
  setDirty(dirty) {
    this.setData({ dirty });
    if (wx.enableAlertBeforeUnload) {
      if (dirty) {
        wx.enableAlertBeforeUnload({ message: '有未保存的修改，确定离开吗？' });
      } else if (wx.disableAlertBeforeUnload) {
        wx.disableAlertBeforeUnload();
      }
    }
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
    this.setDirty(true);
  },

  onSubtitleInput(e) {
    this.setData({ subtitle: e.detail.value });
    this.setDirty(true);
  },

  onKeywordsInput(e) {
    this.setData({ keywordsText: e.detail.value });
    this.setDirty(true);
  },

  // 灵感碎片转记事卡：AI 分流判错的纠正入口（碎片应是要跟进的事项时用）
  // 走 JISHIKA_PENDING_DRAFT 通道预填新建页；inspireRef 记录来源，编辑页保存成功后删该碎片
  onSparkToNote(e) {
    const index = e.currentTarget.dataset.index;
    const spark = this.data.sparks[index];
    if (!spark || !spark.text) return;
    const draft = buildDraftFromContext({ text: spark.text, source: 'inspire' });
    draft.inspireRef = { cardId: this.data.id, index };
    wx.setStorageSync('JISHIKA_PENDING_DRAFT', draft);
    wx.navigateTo({ url: '/pages/card-edit/card-edit?from=inspire' });
  },

  onArticleInput(e) {
    this.setData({ article: e.detail.value });
    this.setDirty(true);
  },

  // 状态：集灵中 / 已输出，用户手动选择，随保存写入
  onStatusTap(e) {
    const status = e.currentTarget.dataset.status;
    if (status === this.data.status) return;
    this.setData({ status });
    this.setDirty(true);
  },

  parseKeywords() {
    return this.data.keywordsText
      .split(/[,，、\s]+/)
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 7);
  },

  // AI 整理：重新提取 标题/副标题/关键词/文章（覆盖当前表单内容）
  onSummarize() {
    if (this.data.summarizing || this.data.saving) return;

    const run = () => {
      this.setData({ summarizing: true });
      summarizeInspireCard(this.data.id)
        .then((card) => {
          this.setData({
            title: card.title || '',
            subtitle: card.subtitle || '',
            keywordsText: (card.keywords || []).join('，'),
            article: card.article || '',
            sparks: Array.isArray(card.sparks) ? card.sparks : this.data.sparks
          });
          this.setDirty(false);
          wx.showToast({ title: '整理完成', icon: 'success' });
        })
        .catch((err) => {
          wx.showToast({ title: err.message || '整理失败', icon: 'none' });
        })
        .finally(() => {
          this.setData({ summarizing: false });
        });
    };

    if (this.data.dirty) {
      wx.showModal({
        title: 'AI 整理',
        content: '将重新生成标题、副标题、关键词和文章，覆盖当前未保存的修改，继续吗？',
        confirmText: '继续',
        success: (res) => {
          if (res.confirm) run();
        }
      });
    } else {
      run();
    }
  },

  onSave() {
    if (this.data.saving || this.data.summarizing) return;
    this.setData({ saving: true });

    updateInspireCard(this.data.id, {
      title: this.data.title,
      subtitle: this.data.subtitle,
      keywords: this.parseKeywords(),
      article: this.data.article,
      status: this.data.status
    })
      .then(() => {
        this.setDirty(false);
        wx.showToast({ title: '已保存', icon: 'success' });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ saving: false });
      });
  }
});
