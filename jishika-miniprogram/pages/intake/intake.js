const { TYPE_LABELS, buildDraftFromContext } = require('../../services/ai-adapter');

Page({
  data: {
    types: [
      { value: 'requirement', label: TYPE_LABELS.requirement },
      { value: 'progress', label: TYPE_LABELS.progress },
      { value: 'todo', label: TYPE_LABELS.todo },
      { value: 'meeting', label: TYPE_LABELS.meeting }
    ],
    selectedType: 'requirement',
    contextText: '',
    source: 'manual',
    files: []
  },

  onLoad(options = {}) {
    const contextText = options.context ? decodeURIComponent(options.context) : '';
    const selectedType = options.type || 'requirement';

    this.setData({
      contextText,
      selectedType,
      source: options.source || 'manual'
    });
  },

  selectType(event) {
    this.setData({
      selectedType: event.currentTarget.dataset.type
    });
  },

  onTextInput(event) {
    this.setData({
      contextText: event.detail.value
    });
  },

  useClipboard() {
    wx.getClipboardData({
      success: (res) => {
        this.setData({
          contextText: res.data || this.data.contextText
        });
        wx.showToast({
          title: '已粘贴',
          icon: 'success'
        });
      },
      fail: () => {
        wx.showToast({
          title: '无法读取剪贴板',
          icon: 'none'
        });
      }
    });
  },

  chooseScreenshot() {
    if (wx.chooseMessageFile) {
      wx.chooseMessageFile({
        count: 3,
        type: 'image',
        success: (res) => {
          this.setData({
            files: (res.tempFiles || []).map((file) => ({
              name: file.name || '聊天截图',
              path: file.path,
              size: file.size
            }))
          });
        },
        fail: () => {}
      });
      return;
    }

    wx.chooseMedia({
      count: 3,
      mediaType: ['image'],
      sourceType: ['album'],
      success: (res) => {
        this.setData({
          files: (res.tempFiles || []).map((file, index) => ({
            name: `聊天截图 ${index + 1}`,
            path: file.tempFilePath,
            size: file.size
          }))
        });
      }
    });
  },

  generateDraft() {
    const hasText = this.data.contextText.trim().length > 0;
    const hasFiles = this.data.files.length > 0;

    if (!hasText && !hasFiles) {
      wx.showToast({
        title: '先粘贴聊天或上传截图',
        icon: 'none'
      });
      return;
    }

    const draft = buildDraftFromContext({
      text: this.data.contextText,
      type: this.data.selectedType,
      source: this.data.source,
      files: this.data.files
    });

    wx.setStorageSync('JISHIKA_PENDING_DRAFT', draft);
    wx.navigateTo({
      url: '/pages/card-edit/card-edit?from=intake'
    });
  }
});
