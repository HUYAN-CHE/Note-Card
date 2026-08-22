const { getNavInfo, getSafeAreaBottom } = require('../../utils/ui');
const { buildDraftFromContext } = require('../../services/ai-adapter');
const {
  getInspireCard,
  updateInspireCard,
  summarizeInspireCard,
  listInspireCards
} = require('../../services/inspire-cards');

// 碎片按来源分段（记录原文区）：私聊/转发/语音/手动；无 source 的旧数据归「记录」
const SOURCE_LABELS = [
  ['wecom-text', '私聊'],
  ['wecom-chatrecord', '转发'],
  ['wecom-voice', '语音'],
  ['manual', '手动']
];

function groupSparksBySource(sparks) {
  const groups = [];
  const fallback = { label: '记录', items: [] };
  SOURCE_LABELS.forEach(([key, label]) => {
    const items = sparks
      .map((s, i) => ({ ...s, index: i }))
      .filter((s) => s.source === key);
    if (items.length) groups.push({ label, items });
  });
  fallback.items = sparks
    .map((s, i) => ({ ...s, index: i }))
    .filter((s) => !s.source || !SOURCE_LABELS.some(([k]) => k === s.source));
  if (fallback.items.length) groups.push(fallback);
  return groups;
}

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
    summarizing: false,
    // 输出动作（集灵中 → 已输出，单向）
    exporting: false,
    // 纸条整理选择态：多选后可移动到别的灵感卡（归集纠错）
    selectMode: false,
    selected: {},
    selectedCount: 0
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
        const sparks = Array.isArray(card.sparks) ? card.sparks : [];
        this.setData({
          loading: false,
          color: this.navColor || card.color || '#cfe8fb',
          title: card.title || '',
          subtitle: card.subtitle || '',
          keywordsText: (card.keywords || []).join('，'),
          article: card.article || '',
          status: card.status === 'exported' ? 'exported' : 'collecting',
          sparks,
          sparkGroups: groupSparksBySource(sparks),
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

  // 「输出」：集灵中 → 已输出（单向动作，非 tag 切换）；输出后脉络才可手动编辑
  onExport() {
    if (this.data.exporting || this.data.saving) return;
    this.setData({ exporting: true });
    updateInspireCard(this.data.id, { status: 'exported' })
      .then(() => {
        this.setData({ status: 'exported' });
        wx.showToast({ title: '已输出，脉络可编辑', icon: 'success' });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '输出失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ exporting: false });
      });
  },

  // 纸条整理：进入/退出多选态
  onToggleSelectMode() {
    const next = !this.data.selectMode;
    this.setData({ selectMode: next, selected: {}, selectedCount: 0 });
  },

  onSparkSelect(e) {
    const index = e.currentTarget.dataset.index;
    const selected = { ...this.data.selected };
    if (selected[index]) {
      delete selected[index];
    } else {
      selected[index] = true;
    }
    this.setData({ selected, selectedCount: Object.keys(selected).length });
  },

  // 移动到别的灵感卡：拉现有集灵中的卡（排除本卡），选择后调 moveSparks
  onMoveTap() {
    const indexes = Object.keys(this.data.selected).map(Number);
    if (!indexes.length) return;
    wx.showLoading({ title: '加载中', mask: true });
    listInspireCards(true)
      .then((cards) => {
        wx.hideLoading();
        const targets = cards.filter((c) => c.id !== this.data.id && c.status === 'collecting');
        if (!targets.length) {
          wx.showToast({ title: '没有其它集灵中的卡', icon: 'none' });
          return;
        }
        wx.showActionSheet({
          itemList: targets.map((c) => c.title),
          success: (sheet) => {
            const target = targets[sheet.tapIndex];
            if (!target) return;
            wx.cloud.callFunction({
              name: 'inspireCard',
              data: { action: 'moveSparks', fromId: this.data.id, toId: target.id, indexes }
            })
              .then((r) => {
                const result = (r && r.result) || {};
                if (result.code === 0) {
                  wx.showToast({ title: `已移到《${target.title}》`, icon: 'success' });
                  this.setData({ selectMode: false, selected: {}, selectedCount: 0 });
                  this.loadDetail();
                } else {
                  wx.showToast({ title: result.message || '移动失败', icon: 'none' });
                }
              })
              .catch(() => wx.showToast({ title: '移动失败', icon: 'none' }));
          }
        });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '加载卡列表失败', icon: 'none' });
      });
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
        title: '重新整理',
        content: '将重新生成标题、副标题、关键词和脉络，覆盖当前未保存的修改，继续吗？',
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
