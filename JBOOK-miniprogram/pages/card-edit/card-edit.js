const { TYPE_LABELS, buildDraftFromContext } = require('../../services/ai-adapter');
const { getCard, createCardFromDraft, saveCard } = require('../../utils/store');
const { getNavInfo, getSafeAreaBottom } = require('../../utils/ui');
const { requestSubscribeCredit } = require('../../utils/subscribe');

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
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
    const navInfo = getNavInfo();
    this.safeBottomPx = getSafeAreaBottom();
    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight,
      safeAreaBottom: this.safeBottomPx
    });
    this.initRecorder();
    this.loadCard(options);
  },

  // 布局说明：顶部创建区为文档流（非 fixed），scroll-view 用 flex 自适应剩余高度，
  // 不再需要测量浮层高度/计算 contentHeight（原 fixed+测量方案会因测量时机偏差遮住表单）

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

  // 底部会员横幅：跳转会员页（会员体系已上线，原为占位 toast）
  onChatCreateTap() {
    wx.navigateTo({ url: '/pages/member/member' });
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
      this.setData({ isParsing: false });
    }
  },


  async chooseAttachmentImages() {
    // 最多 3 张附件
    const remain = 3 - this.data.attachmentImages.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多上传 3 张图片', icon: 'none' });
      return;
    }

    const chooseRes = await new Promise((resolve) => {
      if (wx.chooseMessageFile) {
        wx.chooseMessageFile({ count: remain, type: 'image', success: resolve, fail: () => resolve({ tempFiles: [] }) });
      } else {
        wx.chooseMedia({ count: remain, mediaType: ['image'], sourceType: ['album'], success: resolve, fail: () => resolve({ tempFiles: [] }) });
      }
    });

    const newFiles = (chooseRes.tempFiles || []).slice(0, remain).map((file, index) => ({
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
      theme: draft.theme || this.data.card.theme || '',
      // AI 提取的截止/提醒日期（如"这周五"→YYYY-MM-DD），用户可在日期选择器里改
      deadline: draft.deadline || this.data.card.deadline,
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
    const isNew = !this.data.card.id;
    try {
      const saved = await this.persistCard({ status: 'todo' });
      wx.redirectTo({ url: `/pages/card-detail/card-detail?id=${saved.id}&from=create` });
      if (isNew) {
        this.promptSubscribeAfterCreate();
      }
      return saved;
    } catch (e) {
      // persistCard 已提示
    }
  },

  // 新建成功且有截止日期：顺势引导开启截止提醒（授权一次 = 一条提醒额度）
  promptSubscribeAfterCreate() {
    if (!this.data.card.deadline) return;
    wx.showModal({
      title: '开启截止提醒',
      content: '截止前一天微信提醒你，避免错过待办',
      confirmText: '开启提醒',
      cancelText: '暂不',
      success: async (res) => {
        if (!res.confirm) return;
        // 只累计一次提醒额度，不改 reminderEnabled：
        // 头部订阅按钮、最近记事卡开关、新建后引导三者独立，均只累计次数
        const data = await requestSubscribeCredit({ source: 'create' });
        if (data) {
          wx.showToast({ title: '已开启提醒', icon: 'success' });
        }
      }
    });
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

    if (!this.data.card.deadline) {
      wx.showToast({ title: '请选择截止日期', icon: 'none' });
      throw new Error('截止日期为空');
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
