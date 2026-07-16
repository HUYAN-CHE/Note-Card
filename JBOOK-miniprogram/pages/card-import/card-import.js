const { TYPE_LABELS, buildDraftFromContext } = require('../../services/ai-adapter');
const { getNavInfo } = require('../../utils/ui');

function extractHelperCandidates(text = '') {
  if (!text) return [];
  const matches = text.match(/[@@]([\u4e00-\u9fa5a-zA-Z0-9_]{1,8})/g) || [];
  return Array.from(new Set(matches.map((m) => m.replace(/^[@@]/, '')))).slice(0, 5);
}

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    contentHeight: 500,
    source: 'manual',
    sourceLabel: '手动输入',
    selectedType: 'requirement',
    contextText: '',
    files: [],
    importItems: [
      { key: 'title', label: '标题', value: '', checked: true, ai: true },
      { key: 'desc', label: '需求描述', value: '', checked: true, ai: true },
      { key: 'keyPoints', label: '重点 / 待确认', value: '', checked: true, ai: true },
      { key: 'helpers', label: '共同行动人候选', value: '', checked: true, ai: true }
    ],
    safeAreaBottom: 0,
    clipboardText: '',
    showClipboardHint: false,
    showEmptyGuide: false
  },

  onLoad(options = {}) {
    const sys = wx.getSystemInfoSync();
    const navInfo = getNavInfo();
    const footerHeightPx = 136 * sys.windowWidth / 750 + (sys.safeAreaInsets ? sys.safeAreaInsets.bottom : 0);

    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight,
      contentHeight: sys.windowHeight - navInfo.totalHeight - footerHeightPx,
      safeAreaBottom: sys.safeAreaInsets ? sys.safeAreaInsets.bottom : 0
    });

    const contextText = options.context ? decodeURIComponent(options.context) : '';
    const selectedType = options.type || options.intent || 'requirement';
    const source = options.source || 'manual';

    this.setData({
      contextText,
      selectedType,
      source,
      sourceLabel: this.getSourceLabel(source)
    });

    if (contextText) {
      this.generatePreview(contextText, selectedType, source);
    }
  },

  onShow() {
    if (this.data.contextText) return;
    this.checkClipboard();
  },

  getSourceLabel(source) {
    const map = {
      wechat_ai: '来自微信 AI',
      clipboard: '来自剪贴板',
      screenshot: '来自截图',
      manual: '手动输入'
    };
    return map[source] || '手动输入';
  },

  checkClipboard() {
    wx.getClipboardData({
      success: (res) => {
        const text = (res.data || '').trim();
        if (!text || text === this.data.contextText) {
          this.setData({ showClipboardHint: false, showEmptyGuide: true });
          return;
        }
        this.setData({ clipboardText: text, showClipboardHint: true, showEmptyGuide: false });
      },
      fail: () => {
        this.setData({ showClipboardHint: false, showEmptyGuide: true });
      }
    });
  },

  applyClipboard() {
    const text = this.data.clipboardText;
    this.setData({
      contextText: text,
      source: 'clipboard',
      sourceLabel: '来自剪贴板',
      showClipboardHint: false,
      showEmptyGuide: false
    });
    if (text.trim()) {
      this.generatePreview(text, this.data.selectedType, 'clipboard');
    }
  },

  dismissClipboardHint() {
    this.setData({ showClipboardHint: false, showEmptyGuide: true });
  },

  selectType(event) {
    const selectedType = event.currentTarget.dataset.type;
    this.setData({ selectedType });
    if (this.data.contextText.trim()) {
      this.generatePreview(this.data.contextText, selectedType, this.data.source);
    }
  },

  onTextInput(event) {
    this.setData({ contextText: event.detail.value });
  },

  useClipboard() {
    wx.getClipboardData({
      success: (res) => {
        const text = res.data || '';
        this.setData({ contextText: text, source: 'clipboard', sourceLabel: '来自剪贴板' });
        if (text.trim()) {
          this.generatePreview(text, this.data.selectedType, 'clipboard');
        }
        wx.showToast({ title: '已粘贴', icon: 'success' });
      },
      fail: () => wx.showToast({ title: '无法读取剪贴板', icon: 'none' })
    });
  },

  chooseScreenshot() {
    const cb = (res) => {
      const files = (res.tempFiles || []).map((file, index) => ({
        name: file.name || `聊天截图 ${index + 1}`,
        path: file.path || file.tempFilePath,
        size: file.size
      }));
      this.setData({ files, source: 'screenshot', sourceLabel: '来自截图' });
    };

    if (wx.chooseMessageFile) {
      wx.chooseMessageFile({ count: 3, type: 'image', success: cb, fail: () => {} });
      return;
    }
    wx.chooseMedia({ count: 3, mediaType: ['image'], sourceType: ['album'], success: cb });
  },

  generatePreview(text, type, source) {
    const draft = buildDraftFromContext({ text, type, source, files: this.data.files });
    const helperCandidates = extractHelperCandidates(text);

    const importItems = [
      { key: 'title', label: '标题', value: draft.title || '', checked: true, ai: true },
      { key: 'desc', label: '需求描述', value: draft.desc || '', checked: true, ai: true },
      { key: 'keyPoints', label: '重点 / 待确认', value: (draft.keyPoints || []).join(' · '), checked: true, ai: true },
      { key: 'helpers', label: '共同行动人候选', value: helperCandidates.join(' · '), checked: true, ai: true }
    ];

    this.setData({ importItems, showEmptyGuide: false });
  },

  regenerate() {
    const hasText = this.data.contextText.trim().length > 0;
    const hasFiles = this.data.files.length > 0;

    if (!hasText && !hasFiles) {
      wx.showToast({ title: '先粘贴聊天或上传截图', icon: 'none' });
      return;
    }

    this.generatePreview(this.data.contextText, this.data.selectedType, this.data.source);
  },

  toggleItem(event) {
    const index = event.currentTarget.dataset.index;
    const items = [...this.data.importItems];
    items[index].checked = !items[index].checked;
    this.setData({ importItems: items });
  },

  onItemInput(event) {
    const index = event.currentTarget.dataset.index;
    const items = [...this.data.importItems];
    items[index].value = event.detail.value;
    this.setData({ importItems: items });
  },

  generateCard() {
    const titleItem = this.data.importItems.find((i) => i.key === 'title');
    const descItem = this.data.importItems.find((i) => i.key === 'desc');
    const keyPointsItem = this.data.importItems.find((i) => i.key === 'keyPoints');
    const helpersItem = this.data.importItems.find((i) => i.key === 'helpers');

    const draft = {
      type: this.data.selectedType,
      typeLabel: TYPE_LABELS[this.data.selectedType] || TYPE_LABELS.requirement,
      source: this.data.source,
      title: titleItem && titleItem.checked ? titleItem.value.trim() : '',
      desc: descItem && descItem.checked ? descItem.value.trim() : '',
      keyPoints: keyPointsItem && keyPointsItem.checked
        ? keyPointsItem.value.split('·').map((s) => s.trim()).filter(Boolean)
        : [],
      helperIds: helpersItem && helpersItem.checked
        ? helpersItem.value.split('·').map((s) => s.trim()).filter(Boolean)
        : [],
      files: this.data.files,
      isNetworkVisible: true,
      status: 'draft'
    };

    if (!draft.title) {
      wx.showToast({ title: '标题不能为空', icon: 'none' });
      return;
    }

    wx.setStorageSync('JISHIKA_PENDING_DRAFT', draft);
    wx.navigateTo({ url: '/pages/card-edit/card-edit?from=import' });
  },

  goBack() {
    wx.navigateBack();
  }
});
