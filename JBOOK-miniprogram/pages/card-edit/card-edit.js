const { TYPE_LABELS, buildDraftFromContext } = require('../../services/ai-adapter');
const { getCard, createCardFromDraft, saveCard } = require('../../utils/store');
const { getNavInfo } = require('../../utils/ui');

const DEFAULT_FRIENDS = [
  { id: 'f1', nickname: '阿哲', status: '微信好友', selected: false },
  { id: 'f2', nickname: '小林', status: '已协作 3 次', selected: false },
  { id: 'f3', nickname: '王姐', status: '共同好友', selected: false },
  { id: 'f4', nickname: 'Anna', status: '微信好友', selected: false }
];

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    contentHeight: 500,
    card: {
      title: '',
      desc: '',
      keyPoints: [],
      status: 'draft',
      isNetworkVisible: true,
      helperIds: []
    },
    keyPointsText: '',
    helpers: [],
    showInviteSheet: false,
    friendCandidates: [],
    loadingFriends: false,
    safeAreaBottom: 0,
    isParsing: false,
    isRecording: false,
    parseInputText: '',
    attachmentImages: []
  },

  onLoad(options = {}) {
    const sys = wx.getSystemInfoSync();
    const navInfo = getNavInfo();
    const footerHeightPx = 144 * sys.windowWidth / 750 + (sys.safeAreaInsets ? sys.safeAreaInsets.bottom : 0);
    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight,
      contentHeight: sys.windowHeight - navInfo.totalHeight - footerHeightPx,
      safeAreaBottom: sys.safeAreaInsets ? sys.safeAreaInsets.bottom : 0
    });
    this.initRecorder();
    this.loadCard(options);
    this.loadFriends();
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
    const helperIds = Array.isArray(card.helperIds) ? card.helperIds : [];
    const attachmentFileIDs = Array.isArray(card.attachmentFileIDs) ? card.attachmentFileIDs : [];

    this.setData({
      card: {
        title: card.title || '',
        desc: card.desc || '',
        keyPoints,
        status: card.status || 'draft',
        isNetworkVisible: card.isNetworkVisible !== false,
        helperIds,
        id: card.id || '',
        type: card.type || 'requirement',
        typeLabel: card.typeLabel || TYPE_LABELS[card.type || 'requirement'],
        source: card.source || 'manual'
      },
      keyPointsText: keyPoints.join(' · '),
      helpers: helperIds.map((h) => this.normalizeHelper(h))
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

  async loadFriends() {
    this.setData({ loadingFriends: true });
    try {
      const app = getApp();
      const openid = app.globalData && app.globalData.openid;
      if (app.globalData && app.globalData.cloudReady && wx.cloud && openid) {
        const db = wx.cloud.database();
        const relRes = await db.collection('relationships')
          .where({ ownerId: openid, degree: 1 })
          .limit(50)
          .get();

        const relationships = relRes.data || [];
        if (relationships.length) {
          const friendOpenids = relationships.map((r) => r.to);
          const userRes = await db.collection('users')
            .where({ _openid: db.command.in(friendOpenids) })
            .limit(50)
            .get();

          const users = userRes.data || [];
          const friends = users.map((u) => ({
            id: u._openid,
            nickname: u.nickName || '未知用户',
            avatar: u.avatarUrl || '',
            status: '一度人脉',
            selected: false
          }));

          this.setData({ friendCandidates: friends });
          return;
        }
      }
      this.setData({ friendCandidates: DEFAULT_FRIENDS.map((f) => ({ ...f })) });
    } catch (e) {
      this.setData({ friendCandidates: DEFAULT_FRIENDS.map((f) => ({ ...f })) });
    } finally {
      this.setData({ loadingFriends: false });
    }
  },

  normalizeHelper(raw) {
    if (!raw) return { nickname: '未知', initial: '?', avatar: '' };
    if (typeof raw === 'string') {
      return { id: raw, nickname: raw, initial: this.getInitial(raw), avatar: '' };
    }
    return {
      id: raw.id || '',
      nickname: raw.nickname || raw.name || '未知',
      initial: this.getInitial(raw.nickname || raw.name),
      avatar: raw.avatar || ''
    };
  },

  getInitial(name) {
    if (!name) return '';
    return String(name).trim().charAt(0).toUpperCase();
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

  async parseFromInput() {
    const text = this.data.parseInputText.trim();
    if (!text) {
      wx.showToast({ title: '请先粘贴或输入内容', icon: 'none' });
      return;
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
        this.setData({ parseInputText: '' });
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
      format: 'wav'
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
      const ext = (filePath.split('.').pop() || 'wav').toLowerCase();
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

  openInviteSheet() {
    this.setData({ showInviteSheet: true });
  },

  closeInviteSheet() {
    this.setData({ showInviteSheet: false });
  },

  toggleFriend(event) {
    const index = event.currentTarget.dataset.index;
    const list = [...this.data.friendCandidates];
    list[index].selected = !list[index].selected;
    this.setData({ friendCandidates: list });
  },

  noop() {},

  async sendInvite() {
    try {
      const saved = await this.persistCard({ status: 'todo' });
      this.closeInviteSheet();
      wx.showShareMenu({ withShareTicket: true });
      wx.showToast({ title: '请点击右上角转发', icon: 'none' });
      return saved;
    } catch (e) {
      // persistCard 已提示
    }
  },

  shareToGroup() {
    wx.showShareMenu({ withShareTicket: true });
    wx.showToast({ title: '请选择群聊转发', icon: 'none' });
  },

  goBack() {
    wx.navigateBack();
  },

  async saveDraft() {
    try {
      const saved = await this.persistCard({ status: 'draft' });
      wx.showToast({ title: '已存草稿', icon: 'success' });
      wx.navigateBack();
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

    const selectedFriends = this.data.friendCandidates
      .filter((f) => f.selected)
      .map((f) => f.id || f.nickname);

    const helperIds = Array.from(new Set([
      ...this.data.card.helperIds,
      ...selectedFriends
    ]));

    const attachmentFileIDs = this.data.attachmentImages
      .map((item) => item.fileID)
      .filter(Boolean);

    const card = {
      ...this.data.card,
      ...extra,
      title: this.data.card.title.trim(),
      desc: this.data.card.desc || '',
      keyPoints,
      helperIds,
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
