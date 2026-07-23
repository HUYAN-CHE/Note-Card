const { TYPE_LABELS, buildDraftFromContext } = require('../../services/ai-adapter');
const { getCard, createCardFromDraft, saveCard } = require('../../utils/store');
const { getNavInfo } = require('../../utils/ui');

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    contentHeight: 500,
    floatCardHeightPx: 0,
    card: {
      title: '',
      desc: '',
      keyPoints: [],
      deadline: '',
      status: 'draft',
      isNetworkVisible: true,
      helperIds: []
    },
    keyPointsText: '',
    safeAreaBottom: 0,
    isParsing: false,
    isRecording: false,
    parseInputText: '',
    attachmentImages: []
  },

  onLoad(options = {}) {
    const sys = wx.getSystemInfoSync();
    const navInfo = getNavInfo();
    this.sysInfo = sys;
    this.safeBottomPx = sys.safeAreaInsets
      ? sys.safeAreaInsets.bottom
      : Math.max(0, sys.screenHeight - ((sys.safeArea && sys.safeArea.bottom) || sys.screenHeight));
    // 先用估算值首屏渲染，onReady 中再按实际渲染高度校正
    const estimatePx = Math.round(500 * (sys.windowWidth / 750));
    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight,
      safeAreaBottom: this.safeBottomPx
    });
    this.updateLayout(estimatePx);
    this.initRecorder();
    this.loadCard(options);
  },

  onReady() {
    this.measureFloatCard();
  },

  // 底部操作栏实际占位高度（px）：上下内边距 48rpx + 按钮 96rpx + 安全区
  getFooterHeightPx() {
    const sys = this.sysInfo || wx.getSystemInfoSync();
    return 144 * (sys.windowWidth / 750) + this.safeBottomPx;
  },

  updateLayout(floatCardHeightPx) {
    const sys = this.sysInfo || wx.getSystemInfoSync();
    const contentHeight = sys.windowHeight - this.data.totalHeight - floatCardHeightPx - this.getFooterHeightPx();
    this.setData({ floatCardHeightPx, contentHeight });
  },

  // 实测顶部浮层高度，避免不同机型/文案换行导致表单区与底部按钮被遮挡
  measureFloatCard() {
    wx.createSelectorQuery()
      .in(this)
      .select('.float-create-card')
      .boundingClientRect()
      .exec((res) => {
        const rect = res && res[0];
        if (!rect || !rect.height) return;
        const height = Math.round(rect.height);
        if (height !== this.data.floatCardHeightPx) {
          this.updateLayout(height);
        }
      });
  },

  async loadCard(options = {}) {
    const storedCard = options.id ? await getCard(options.id) : null;
    const pendingDraft = wx.getStorageSync('JISHIKA_PENDING_DRAFT');
    const blankDraft = buildDraftFromContext({ text: '', type: 'requirement', source: 'manual' });

    const card = storedCard || pendingDraft || blankDraft;
    this.setCard(card);
  },

  setCard(card) {
    const keyPoints = Array.isArray(card.keyPoints) ? card.keyPoints : [];
    const attachmentFileIDs = Array.isArray(card.attachmentFileIDs) ? card.attachmentFileIDs : [];

    this.setData({
      card: {
        title: card.title || '',
        desc: card.desc || '',
        keyPoints,
        deadline: card.deadline || '',
        status: card.status || 'draft',
        isNetworkVisible: card.isNetworkVisible !== false,
        helperIds: Array.isArray(card.helperIds) ? card.helperIds : [],
        id: card.id || '',
        type: card.type || 'requirement',
        typeLabel: card.typeLabel || TYPE_LABELS[card.type || 'requirement'],
        source: card.source || 'manual'
      },
      keyPointsText: keyPoints.join(' · ')
    });

    if (attachmentFileIDs.length && wx.cloud) {
      wx.cloud.getTempFileURL({
        fileList: attachmentFileIDs.map((fileID) => ({ fileID, maxAge: 3600 })),
        success: (res) => {
          const images = (res.fileList || []).map((item, index) => ({
            name: `图片 ${index + 1}`,
            tempPath: item.tempFileURL,
            fileID: attachmentFileIDs[index]
          }));
          this.setData({ attachmentImages: images });
        }
      });
    }
  },

  onTitleInput(event) {
    this.setData({ 'card.title': event.detail.value });
  },

  onDescInput(event) {
    this.setData({ 'card.desc': event.detail.value });
  },

  onKeyPointsInput(event) {
    this.setData({ keyPointsText: event.detail.value });
  },

  onDeadlineChange(event) {
    this.setData({ 'card.deadline': event.detail.value });
  },

  initRecorder() {
    const recorderManager = wx.getRecorderManager();
    recorderManager.onStart(() => {
      console.log('[recorder] onStart');
      this.setData({ isRecording: true });
      wx.showToast({ title: '开始录音，请说话', icon: 'none' });
    });
    recorderManager.onStop((res) => {
      console.log('[recorder] onStop:', JSON.stringify(res));
      this.setData({ isRecording: false });
      if (res.tempFilePath) {
        this.uploadVoiceAndParse(res.tempFilePath);
      }
    });
    recorderManager.onError((err) => {
      console.log('[recorder] onError:', JSON.stringify(err));
      this.setData({ isRecording: false });
      wx.showToast({ title: '录音失败: ' + (err.message || ''), icon: 'none' });
    });
    this.recorderManager = recorderManager;
  },

  onParseInput(event) {
    this.setData({ parseInputText: event.detail.value });
  },

  onChatCreateTap() {
    wx.showToast({ title: '正在开发中，敬请期待', icon: 'none' });
  },

  async parseFromInput() {
    let text = this.data.parseInputText.trim();
    if (!text) {
      // 输入框为空时直接读取剪贴板，点"粘贴识别"一步到位
      text = await new Promise((resolve) => {
        wx.getClipboardData({
          success: (res) => resolve((res.data || '').trim()),
          fail: () => resolve('')
        });
      });
      if (!text) {
        wx.showToast({ title: '剪贴板为空，请先复制内容', icon: 'none' });
        return;
      }
      this.setData({ parseInputText: text });
    }

    this.setData({ isParsing: true });
    wx.showLoading({ title: '识别中...' });

    try {
      const app = getApp();
      if (!app.globalData || !app.globalData.cloudReady || !wx.cloud) {
        this.localParse(text);
        this.setData({ parseInputText: '' });
        return;
      }

      const res = await wx.cloud.callFunction({
        name: 'parseContext',
        data: { action: 'parseText', text, type: this.data.card.type }
      });

      if (res.result && res.result.code === 0) {
        this.applyParsedDraft(res.result.data);
        wx.showToast({ title: '识别成功', icon: 'success' });
      } else {
        wx.showToast({ title: res.result.message || '识别失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: e.message || '识别失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ isParsing: false });
    }
  },

  startVoiceInput() {
    if (!this.recorderManager) {
      wx.showToast({ title: '录音未初始化', icon: 'none' });
      return;
    }
    if (this.data.isRecording) {
      console.log('[startVoiceInput] stopping recorder');
      this.recorderManager.stop();
      return;
    }
    if (this.data.isParsing) return;

    console.log('[startVoiceInput] starting recorder');
    this.recorderManager.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'aac'
    });
  },

  async uploadVoiceAndParse(filePath) {
    this.setData({ isParsing: true });
    wx.showLoading({ title: '语音识别中...' });

    try {
      const app = getApp();
      if (!app.globalData || !app.globalData.cloudReady || !wx.cloud) {
        wx.showToast({ title: '云开发未就绪', icon: 'none' });
        return;
      }

      // 诊断：读取本地录音文件信息
      const fs = wx.getFileSystemManager();
      const fileInfo = await new Promise((resolve, reject) => {
        fs.getFileInfo({
          filePath,
          success: (r) => resolve(r),
          fail: (err) => resolve({ size: 0, digest: '', error: err })
        });
      });
      const headerBytes = await new Promise((resolve) => {
        fs.readFile({
          filePath,
          position: 0,
          length: 16,
          encoding: 'hex',
          success: (r) => resolve(r.data),
          fail: () => resolve('')
        });
      });
      console.log('[uploadVoiceAndParse] local voice info:', {
        filePath,
        size: fileInfo.size,
        header: headerBytes
      });

      // 先上传音频到云存储，再用 fileID 让云函数下载识别
      const ext = (filePath.split('.').pop() || 'aac').toLowerCase();
      const cloudPath = `voice_tmp/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath });
      const fileID = uploadRes.fileID;
      console.log('[uploadVoiceAndParse] uploaded fileID:', fileID);

      const res = await wx.cloud.callFunction({
        name: 'parseContext',
        data: { action: 'parseVoice', fileID, format: ext, type: this.data.card.type }
      });

      console.log('[uploadVoiceAndParse] parseContext result:', res.result);

      if (res.result && res.result.code === 0) {
        this.applyParsedDraft(res.result.data);
        const rawText = res.result.data && res.result.data.rawText;
        if (rawText) {
          this.setData({ parseInputText: rawText });
        }
        wx.showToast({ title: '识别成功', icon: 'success' });
      } else {
        wx.showToast({ title: res.result.message || '语音识别失败', icon: 'none' });
      }
    } catch (e) {
      console.error('[uploadVoiceAndParse] catch error:', e);
      wx.showToast({ title: e.message || '语音识别失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ isParsing: false });
    }
  },


  async chooseAttachmentImages() {
    const chooseRes = await new Promise((resolve) => {
      if (wx.chooseMessageFile) {
        wx.chooseMessageFile({ count: 9, type: 'image', success: resolve, fail: () => resolve({ tempFiles: [] }) });
      } else {
        wx.chooseMedia({ count: 9, mediaType: ['image'], sourceType: ['album'], success: resolve, fail: () => resolve({ tempFiles: [] }) });
      }
    });

    const newFiles = (chooseRes.tempFiles || []).map((file, index) => ({
      name: file.name || `图片 ${index + 1}`,
      tempPath: file.path || file.tempFilePath,
      size: file.size,
      fileID: ''
    }));

    if (!newFiles.length) return;

    wx.showLoading({ title: '上传中...' });

    try {
      const app = getApp();
      if (!app.globalData || !app.globalData.cloudReady || !wx.cloud) {
        wx.showToast({ title: '云开发未就绪', icon: 'none' });
        return;
      }

      const uploadTasks = newFiles.map((file) => {
        const ext = (file.tempPath.split('.').pop() || 'jpg').toLowerCase();
        const cloudPath = `attachments/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
        return wx.cloud.uploadFile({ cloudPath, filePath: file.tempPath });
      });

      const uploadResults = await Promise.all(uploadTasks);
      uploadResults.forEach((r, i) => {
        newFiles[i].fileID = r.fileID;
      });

      const attachmentImages = [...this.data.attachmentImages, ...newFiles];
      this.setData({ attachmentImages });
    } catch (e) {
      wx.showToast({ title: e.message || '上传失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  previewAttachment(event) {
    const index = event.currentTarget.dataset.index;
    const urls = this.data.attachmentImages.map((item) => item.tempPath);
    wx.previewImage({ current: urls[index], urls });
  },

  removeAttachment(event) {
    const index = event.currentTarget.dataset.index;
    const attachmentImages = [...this.data.attachmentImages];
    attachmentImages.splice(index, 1);
    this.setData({ attachmentImages });
  },

  toggleVisibility() {
    this.setData({ 'card.isNetworkVisible': !this.data.card.isNetworkVisible });
  },

  applyParsedDraft(draft) {
    const type = draft.type || this.data.card.type || 'requirement';
    const card = {
      ...this.data.card,
      title: draft.title || this.data.card.title,
      desc: draft.desc || this.data.card.desc,
      keyPoints: Array.isArray(draft.keyPoints) ? draft.keyPoints : this.data.card.keyPoints,
      type,
      typeLabel: TYPE_LABELS[type] || this.data.card.typeLabel,
      source: draft.source || this.data.card.source
    };
    this.setCard(card);
  },

  localParse(text) {
    const draft = buildDraftFromContext({ text, type: this.data.card.type, source: 'clipboard_ai' });
    this.applyParsedDraft(draft);
    wx.showToast({ title: '已本地识别', icon: 'success' });
  },

  // 生成记事卡：保存后进入详情页，在下一步邀请共同行动人
  async generateCard() {
    try {
      const saved = await this.persistCard({ status: 'todo' });
      wx.redirectTo({ url: `/pages/card-detail/card-detail?id=${saved.id}&from=create` });
      return saved;
    } catch (e) {
      // persistCard 已提示
    }
  },

  async saveAndBack() {
    try {
      const saved = await this.persistCard({ status: 'todo' });
      wx.showToast({ title: '保存成功', icon: 'success' });
      wx.navigateBack();
      return saved;
    } catch (e) {
      // persistCard 已提示
    }
  },

  async persistCard(extra = {}) {
    if (!this.data.card.title.trim()) {
      wx.showToast({ title: '请输入标题', icon: 'none' });
      throw new Error('标题为空');
    }

    const keyPoints = this.data.keyPointsText
      .split('·')
      .map((item) => item.trim())
      .filter(Boolean);

    const attachmentFileIDs = this.data.attachmentImages
      .map((item) => item.fileID)
      .filter(Boolean);

    const card = {
      ...this.data.card,
      ...extra,
      title: this.data.card.title.trim(),
      desc: this.data.card.desc || '',
      keyPoints,
      deadline: this.data.card.deadline || '',
      helperIds: this.data.card.helperIds,
      isNetworkVisible: this.data.card.isNetworkVisible,
      attachmentFileIDs
    };

    const saved = card.id ? await saveCard(card) : await createCardFromDraft(card);
    wx.removeStorageSync('JISHIKA_PENDING_DRAFT');
    this.setCard(saved);
    return saved;
  },

  onShareAppMessage() {
    const card = this.data.card || {};
    const title = card.title
      ? `邀请你一起用《${card.title}》`
      : '邀请你一起用记事卡';
    return {
      title,
      path: card.id ? `/pages/card-detail/card-detail?id=${card.id}` : '/pages/home/home',
      imageUrl: '/assets/logo.png'
    };
  }
});
