const store = require('../../utils/store.js');
const { getNavInfo } = require('../../utils/ui');
const { collections } = require('../../config/env');
const { uploadAvatar } = require('../../utils/upload-avatar');

const USER_PROFILE_KEY = 'JISHIKA_USER_PROFILE';

const STATUS_MAP = {
  draft: { text: '待确认', class: 'todo' },
  todo: { text: '待确认', class: 'todo' },
  doing: { text: '进行中', class: 'doing' },
  done: { text: '已完成', class: 'done' }
};

function cleanNickname(name) {
  if (!name || String(name).trim() === '我') return '';
  return String(name).trim();
}

function getInitial(name) {
  if (!name) return '';
  return String(name).trim().charAt(0).toUpperCase();
}

// 截止日期早于今天且未完成时视为已逾期
function checkOverdue(card) {
  if (!card || !card.deadline || card.status === 'done') return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return card.deadline < today;
}

// 从小程序码 scene 参数中解析短码（格式 r=XXXXXX）
function parseSceneRef(scene) {
  if (!scene) return '';
  let decoded = scene;
  try {
    decoded = decodeURIComponent(scene);
  } catch (e) {}
  const match = decoded.match(/(?:^|&)r=([A-Za-z0-9]+)/);
  return match ? match[1].toUpperCase() : '';
}

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    cardId: '',
    card: {},
    // 品牌行箭头（WXML 不解析 HTML 实体，"<" 必须由数据绑定注入）
    brandChevronLeft: '>>>>>>>>>>',
    brandChevronRight: '<<<<<<<<<<',
    creator: { nickname: '', avatar: '', initial: '', relationText: '创立者' },
    helpers: [],
    keyPoints: [],
    statusClass: 'doing',
    statusText: '进行中',
    isOverdue: false,
    role: 'stranger',
    isCreator: false,
    isHelper: false,
    isNetworkView: false,
    showApplyArea: false,
    canAcceptInvite: false,
    showApplySheet: false,
    applyMessage: '',
    pendingRequests: [],
    // 互助页带入的引荐人 openid（helperOpenid）
    intermediaryOpenid: '',
    // 申请人视角：自己最新一条申请的状态与 ID（空串=无申请）
    myJoinStatus: '',
    myJoinRequestId: '',
    loading: false,
    safeAreaBottom: 0,
    cardReady: false,
    canEditStatus: false,
    refCode: '',
    developing: false,
    displayDeadline: '',
    qrCodeSrc: '',
    displayTitle: '',
    showEditSheet: false,
    editForm: { title: '', desc: '', keyPointsText: '' },
    showActivitySheet: false,
    activities: [],
    activitiesLoading: false,
    attachments: [],
    projectThumb: '',
    projectLabel: '',
    visibleAvatars: [],
    showAvatarMore: false,
    allCollaborators: [],
    showHelpersSheet: false,
    // 接受邀请后的授权补全弹窗（与首页授权弹窗同款）
    showAuthModal: false,
    authProfile: {
      nickname: '',
      avatar: '',
      initial: ''
    }
  },

  onLoad(options) {
    const sys = wx.getSystemInfoSync();
    const navInfo = getNavInfo();
    // iPhone Home 指示条安全区兜底：safeAreaInsets 缺失时用 safeArea 计算
    const safeBottom = sys.safeAreaInsets
      ? sys.safeAreaInsets.bottom
      : Math.max(0, sys.screenHeight - ((sys.safeArea && sys.safeArea.bottom) || sys.screenHeight));

    // 从「生成记事卡」跳转而来时，播放出票机打印动画（2s 滑出）+ 打印音效
    const developing = options.from === 'create';
    this.fromCreate = developing;

    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight,
      safeAreaBottom: safeBottom,
      developing
    });

    const cardId = options.id || '';
    // 支持 ?ref= 短码与小程序码 scene（r=XXXXXX）进入，统一转大写
    const refCode = (options.ref || parseSceneRef(options.scene) || '').toUpperCase();
    // 互助页带入的引荐人 openid；endorse= 为「帮 TA 引荐」分享链接带入的申请 ID
    const intermediaryOpenid = options.helperOpenid || '';
    this.endorseRequestId = options.endorse || '';
    // 入口区分：互助页二度入口带 view=network、引荐分享带 endorse，其余（ref 短码/裸 id/扫码）均为邀请入口
    this.inviteEntry = options.view !== 'network' && !this.endorseRequestId;

    if (cardId) {
      this.setData({ cardId, intermediaryOpenid });
      this.loadCard(cardId).then(() => this.maybePromptEndorse());
    } else if (refCode) {
      this.loadCardByRef(refCode);
    } else {
      wx.showToast({ title: '缺少卡片ID', icon: 'none' });
    }
  },

  onUnload() {
    if (this.printerAudio) {
      this.printerAudio.destroy();
      this.printerAudio = null;
    }
  },

  async loadCard(id) {
    this.setData({ loading: true });

    try {
      const app = getApp();
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const res = await wx.cloud.callFunction({
          name: 'getCardDetail',
          data: { id }
        });

        if (res.result && res.result.code === 0) {
          this.renderCard(res.result.data);
          return;
        }
      }

      const card = await store.getCard(id) || {};
      this.renderLocalCard(card);
    } catch (e) {
      console.error('loadCard error', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 通过 Agent 短码进入：先解析出卡片 ID，再走正常加载（含云端权限判定）
  async loadCardByRef(code) {
    this.setData({ loading: true });
    try {
      const card = await store.getCardByRef(code);
      if (card && card.id) {
        this.setData({ cardId: card.id });
        await this.loadCard(card.id);
        return;
      }
      wx.showToast({ title: '短码不存在或已失效', icon: 'none' });
    } catch (e) {
      console.error('loadCardByRef error', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 头像组（叠压排布，叠压统一 -15rpx；点头像/「…」圆开弹窗）：
  // ≤5 全显；>5 → 前 4 头像 + 「…」圆（第 5 位）；卡片上不再有添加圆
  buildAvatarGroup(creator, helpers) {
    const people = [creator, ...(helpers || [])].filter(Boolean);
    if (people.length <= 5) return { visibleAvatars: people, showAvatarMore: false };
    return { visibleAvatars: people.slice(0, 4), showAvatarMore: true };
  },

  // 全部成员列表：创立者在前，供「…」弹窗展示头像和昵称
  buildAllCollaborators(creator, helpers) {
    const list = [creator, ...(helpers || [])].filter(Boolean);
    return list.map((p, index) => ({
      ...p,
      nickname: p.nickname || '未知用户',
      roleText: index === 0 ? '创立者' : '协作人'
    }));
  },

  renderCard(data) {
    const role = data.role || 'stranger';
    const isCreator = role === 'creator';
    const isHelper = role === 'helper';
    const isNetworkView = role === 'network';
    // 邀请入口（ref 短码/裸 id/扫码）优先按被邀请人视角：即使卡片网络可见被判 network，
    // 也显示「接受邀请」而非「申请加入」；互助页二度入口（view=network）才走申请链路
    const inviteEntry = this.inviteEntry === true;
    const showApplyArea = isNetworkView && !inviteEntry;

    const statusInfo = STATUS_MAP[data.status] || { text: data.status || '进行中', class: 'doing' };
    const keyPoints = Array.isArray(data.keyPoints) ? data.keyPoints : [];
    const creator = data.creator || this.data.creator;
    const helpers = data.helpers || [];
    const avatarGroup = this.buildAvatarGroup(creator, helpers);
    // 申请人视角：自己最新一条申请（仅 network 角色云端才会返回）
    const myJoinRequest = data.myJoinRequest || null;

    this.setData({
      card: data,
      creator,
      helpers,
      visibleAvatars: avatarGroup.visibleAvatars,
      showAvatarMore: avatarGroup.showAvatarMore,
      allCollaborators: this.buildAllCollaborators(creator, helpers),
      keyPoints,
      statusClass: statusInfo.class,
      statusText: statusInfo.text,
      isOverdue: checkOverdue(data),
      role,
      isCreator,
      isHelper,
      isNetworkView,
      showApplyArea,
      canAcceptInvite: !isCreator && !isHelper && (role === 'stranger' || (isNetworkView && inviteEntry)),
      pendingRequests: data.pendingRequests || [],
      myJoinStatus: myJoinRequest ? myJoinRequest.status : '',
      myJoinRequestId: myJoinRequest ? myJoinRequest.id : '',
      cardReady: true,
      canEditStatus: isCreator || isHelper,
      refCode: data.refCode || '',
      displayDeadline: this.formatDeadline(data.deadline),
      displayTitle: this.truncateTitle(data.title),
      projectLabel: this.truncateTitle(data.title || '项目', 4)
    }, () => {
      // 打印动画（cardReady 触发）开始时同步播放出票机音效
      if (this.fromCreate && !this.printerAudio) {
        const printerAudio = wx.createInnerAudioContext();
        printerAudio.src = '/assets/audio/printer.m4a';
        printerAudio.play();
        this.printerAudio = printerAudio;
      }
      this.onCardRendered();
      this.ensureRefCode(data);
      this.loadQrCode();
      this.loadAttachments(data);
    });
  },

  renderLocalCard(card) {
    const creator = this.normalizeUser(card.creatorId || card.creator || '未知用户');
    const helpers = (card.helperIds || card.helpers || []).map((h) => this.normalizeUser(h));
    const keyPoints = Array.isArray(card.keyPoints) ? card.keyPoints : [];
    const statusInfo = STATUS_MAP[card.status] || { text: card.status || '进行中', class: 'doing' };

    const openid = this.getCurrentOpenid();
    const isCreator = card.creatorId === openid;
    const isHelper = Array.isArray(card.helperIds) && card.helperIds.includes(openid);
    const avatarGroup = this.buildAvatarGroup(creator, helpers);

    this.setData({
      card,
      creator,
      helpers,
      visibleAvatars: avatarGroup.visibleAvatars,
      showAvatarMore: avatarGroup.showAvatarMore,
      allCollaborators: this.buildAllCollaborators(creator, helpers),
      keyPoints,
      statusClass: statusInfo.class,
      statusText: statusInfo.text,
      isOverdue: checkOverdue(card),
      role: isCreator ? 'creator' : (isHelper ? 'helper' : 'stranger'),
      isCreator,
      isHelper,
      isNetworkView: false,
      showApplyArea: false,
      canAcceptInvite: !isCreator && !isHelper,
      pendingRequests: [],
      // 本地兜底路径无云端申请数据，按无申请处理
      myJoinStatus: '',
      myJoinRequestId: '',
      cardReady: true,
      canEditStatus: isCreator || isHelper,
      refCode: card.refCode || '',
      displayDeadline: this.formatDeadline(card.deadline),
      displayTitle: this.truncateTitle(card.title),
      projectLabel: this.truncateTitle(card.title || '项目', 4)
    }, () => {
      this.onCardRendered();
      this.ensureRefCode(card);
      this.loadQrCode();
      this.loadAttachments(card);
    });
  },

  // 项目圆缩略图：取附件第一张，云端 fileID 转临时 URL；无附件走标题首字
  loadAttachments(card) {
    const fileIDs = Array.isArray(card && card.attachmentFileIDs)
      ? card.attachmentFileIDs.filter(Boolean)
      : [];

    if (!fileIDs.length || !wx.cloud) {
      this.setData({ attachments: [], projectThumb: '' });
      return;
    }

    wx.cloud.getTempFileURL({
      fileList: fileIDs.map((fileID) => ({ fileID, maxAge: 3600 })),
      success: (res) => {
        const attachments = (res.fileList || [])
          .map((item, index) => ({ fileID: fileIDs[index], tempPath: item.tempFileURL || '' }))
          .filter((item) => item.tempPath);
        this.setData({
          attachments,
          projectThumb: attachments.length ? attachments[0].tempPath : ''
        });
      },
      fail: () => {
        this.setData({ attachments: [], projectThumb: '' });
      }
    });
  },

  // 点击项目圆：有附件时放大预览，多图可左右滑动（圆上角标提示张数）
  onProjectAvatarTap() {
    const urls = this.data.attachments.map((item) => item.tempPath);
    if (!urls.length) return;
    wx.previewImage({ current: urls[0], urls });
  },

  // 点头像/「…」圆：有权限开编辑弹窗（内含共同行动人列表），无权限开只读成员列表
  onAvatarTap() {
    if (this.data.canEditStatus) {
      this.openEditSheet();
    } else {
      this.openHelpersSheet();
    }
  },

  // 旧卡无短码时静默补齐（不影响渲染，失败忽略）
  async ensureRefCode(card) {
    if (!card || !card.id || card.refCode) return;
    try {
      const refCode = store.genRefCode();
      const saved = await store.updateCard(card.id, { refCode });
      if (saved && saved.refCode) {
        this.setData({
          refCode: saved.refCode,
          card: { ...this.data.card, refCode: saved.refCode }
        });
        this.loadQrCode();
      }
    } catch (e) {}
  },

  // 截止日期显示完整格式（含年）
  formatDeadline(deadline) {
    return deadline ? String(deadline) : '';
  },

  // 标题最多显示 7 个字，超出截断加省略号
  truncateTitle(title, max = 7) {
    const t = String(title || '未命名事项');
    return t.length > max ? `${t.slice(0, max)}...` : t;
  },

  // 卡内小程序码：云端可用且有短码时拉取，失败保持占位框
  async loadQrCode() {
    if (this.data.qrCodeSrc || !this.data.refCode) return;
    const src = await this.fetchQrCodeSrc();
    if (src) this.setData({ qrCodeSrc: src });
  },

  normalizeUser(raw) {
    if (!raw) return { nickname: '未知用户', avatar: '', initial: '', isMe: false };
    if (typeof raw === 'string') {
      return {
        id: raw,
        nickname: raw,
        avatar: '',
        initial: getInitial(raw),
        isMe: this.isCurrentUser(raw)
      };
    }
    return {
      id: raw.id || raw._openid || '',
      nickname: cleanNickname(raw.nickname || raw.name) || '未知用户',
      avatar: raw.avatar || raw.avatarUrl || '',
      initial: getInitial(raw.nickname || raw.name),
      isMe: this.isCurrentUser(raw.id || raw._openid || raw.nickname)
    };
  },

  isCurrentUser(value) {
    if (!value) return false;
    const openid = this.getCurrentOpenid();
    const myProfile = wx.getStorageSync('JISHIKA_USER_PROFILE') || {};
    return value === cleanNickname(myProfile.nickname) || value === openid;
  },

  getCurrentOpenid() {
    try {
      return (getApp().globalData && getApp().globalData.openid) || wx.getStorageSync('JISHIKA_OPENID') || '';
    } catch (e) {
      return '';
    }
  },

  // ==================== Agent 口令 ====================

  onCopyRefCode() {
    const { card, refCode } = this.data;
    if (!refCode) {
      wx.showToast({ title: '编号生成中，请稍候', icon: 'none' });
      return;
    }
    const text = [
      `【记事卡 #${refCode}】「${card.title || '未命名事项'}」`,
      '发给微信 AI 并说「打开这张卡」，AI 可通过 resolveCardRef 云函数读取本卡结构化内容'
    ].join('\n');
    wx.setClipboardData({ data: text });
  },

  // ==================== 申请加入 ====================

  openApplySheet() {
    this.setData({ showApplySheet: true, applyMessage: '' });
  },

  closeApplySheet() {
    this.setData({ showApplySheet: false });
  },

  onApplyInput(e) {
    this.setData({ applyMessage: e.detail.value });
  },

  async submitApply() {
    const { cardId, applyMessage, intermediaryOpenid } = this.data;
    if (!cardId) return;

    try {
      const res = await wx.cloud.callFunction({
        name: 'applyToJoinCard',
        data: { cardId, note: applyMessage, intermediaryId: intermediaryOpenid || '' }
      });

      if (res.result && res.result.code === 0) {
        const result = res.result.data || {};
        const status = result.status || 'pending';
        this.closeApplySheet();

        if (status === 'pending_intermediary') {
          // 引荐制：申请先到引荐人，引导申请人转发给一度好友帮忙引荐
          this.setData({
            myJoinStatus: 'pending_intermediary',
            myJoinRequestId: result.requestId || ''
          });
          wx.showModal({
            title: '申请已提交',
            content: '还需好友帮你引荐给卡主。点底部「待引荐 · 转发给好友引荐」把申请发给 TA',
            confirmText: '知道了',
            showCancel: false
          });
        } else {
          this.setData({ myJoinStatus: 'pending' });
          wx.showToast({ title: '申请已提交', icon: 'success' });
        }
      } else {
        wx.showToast({ title: res.result.message || '申请失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '申请失败', icon: 'none' });
    }
  },

  // 通过「帮 TA 引荐」分享链接进入：卡片加载完成后弹引荐确认
  maybePromptEndorse() {
    const requestId = this.endorseRequestId;
    if (!requestId || !this.data.cardReady) return;
    this.endorseRequestId = '';

    const title = (this.data.card && this.data.card.title) || '这张卡';
    wx.showModal({
      title: '帮 TA 引荐',
      content: `你的好友申请加入「${title}」，确认帮 TA 引荐给卡主？`,
      confirmText: '帮 TA 引荐',
      cancelText: '再看看',
      success: (res) => {
        if (res.confirm) this.endorseJoinRequest(requestId);
      }
    });
  },

  async endorseJoinRequest(requestId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'endorseJoinRequest',
        data: { requestId }
      });

      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '已引荐给卡主', icon: 'success' });
      } else {
        wx.showToast({ title: (res.result && res.result.message) || '引荐失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '引荐失败', icon: 'none' });
    }
  },

  // 接受邀请
  async acceptInvite() {
    const { cardId } = this.data;
    if (!cardId) return;

    try {
      const res = await wx.cloud.callFunction({
        name: 'inviteHelper',
        data: { cardId }
      });

      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '已加入', icon: 'success' });
        this.loadCard(cardId);
        // 被邀请人可能从未走过首页授权：未授权则补弹授权弹窗，
        // 否则协作者头像组/协作记录只能显示首字母与「未知用户」
        this.checkInviteAuth();
      } else {
        wx.showToast({ title: res.result.message || '加入失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '加入失败', icon: 'none' });
    }
  },

  // ==================== 授权补全（接受邀请后，与首页授权弹窗同款逻辑） ====================

  // 判定口径与首页 home.js checkAuth 一致：本地缓存有效即用，否则回源云端 users 表
  async checkInviteAuth() {
    let profile = wx.getStorageSync(USER_PROFILE_KEY) || {};
    let nickname = profile.nickname && String(profile.nickname).trim();
    let authorized = Boolean(nickname && nickname !== '我' && profile.avatar);

    if (!authorized) {
      const cloudProfile = await this.fetchCloudProfile();
      if (cloudProfile) {
        profile = cloudProfile;
        nickname = cloudProfile.nickname;
        authorized = true;
        wx.setStorageSync(USER_PROFILE_KEY, cloudProfile);
        try {
          getApp().globalData.userProfile = cloudProfile;
        } catch (e) {}
      }
    }

    if (authorized) return;

    const safeNickname = nickname === '我' ? '' : nickname;
    this.setData({
      showAuthModal: true,
      authProfile: {
        nickname: safeNickname || '',
        avatar: profile.avatar || '',
        initial: profile.initial || (safeNickname ? safeNickname.charAt(0).toUpperCase() : '')
      }
    });
  },

  // 从云端 users 表读授权信息；无有效记录返回 null（同首页 fetchCloudProfile）
  async fetchCloudProfile() {
    try {
      const app = getApp();
      if (!app.globalData || !app.globalData.cloudReady || !wx.cloud) return null;
      // 冷启动竞态：app 的 login 云函数是异步的，openid 可能还没就绪，短暂等待
      let openid = app.globalData.openid || wx.getStorageSync('JISHIKA_OPENID');
      if (!openid) {
        for (let i = 0; i < 10 && !openid; i++) {
          await new Promise((r) => setTimeout(r, 300));
          openid = app.globalData.openid || wx.getStorageSync('JISHIKA_OPENID');
        }
      }
      if (!openid) return null;
      const db = wx.cloud.database();
      const res = await db.collection(collections.users)
        .where({ _openid: openid })
        .limit(1)
        .get();
      const user = res.data && res.data[0];
      if (!user) return null;
      const nickname = user.nickName && String(user.nickName).trim();
      if (!nickname || nickname === '我' || !user.avatarUrl) return null;
      return {
        nickname,
        avatar: user.avatarUrl,
        initial: user.initial || nickname.charAt(0).toUpperCase(),
        serviceTags: Array.isArray(user.serviceTags) ? user.serviceTags : []
      };
    } catch (e) {
      return null;
    }
  },

  async onAuthAvatar(event) {
    const tempUrl = event.detail.avatarUrl;
    if (!tempUrl) return;
    // 先用临时路径即时显示；上传云存储成功后换 cloud:// fileID（临时路径重启即失效）
    this.setData({ 'authProfile.avatar': tempUrl });
    const fileID = await uploadAvatar(tempUrl);
    // 上传失败不保留微信临时路径：http://tmp 在其他用户设备上加载不了，写库即裂图
    this.setData({ 'authProfile.avatar': fileID || '' });
    this.tryFinishAuth();
  },

  onAuthNicknameInput(event) {
    const nickname = event.detail.value || '';
    this.setData({ 'authProfile.nickname': nickname });
    if (nickname.trim()) {
      this.setAuthNickname(nickname.trim());
    }
  },

  setAuthNickname(nickname) {
    const initial = nickname.trim().charAt(0).toUpperCase();
    this.setData({
      'authProfile.nickname': nickname,
      'authProfile.initial': initial
    }, () => {
      this.tryFinishAuth();
    });
  },

  async tryFinishAuth() {
    const { authProfile } = this.data;
    if (!authProfile.nickname || !authProfile.avatar) return;
    await this.finishAuth({ ...authProfile, serviceTags: [] });
  },

  // upsert users 与首页 finishAuth 一致；成功后刷新本页让头像组立即显示真头像
  async finishAuth(profile) {
    const safeProfile = {
      nickname: cleanNickname(profile.nickname),
      avatar: profile.avatar || '',
      initial: profile.initial && String(profile.initial).trim() !== '我' ? String(profile.initial).trim() : '',
      serviceTags: Array.isArray(profile.serviceTags) ? profile.serviceTags : []
    };
    if (safeProfile.nickname && !safeProfile.initial) {
      safeProfile.initial = safeProfile.nickname.charAt(0).toUpperCase();
    }

    wx.setStorageSync(USER_PROFILE_KEY, safeProfile);
    try {
      const app = getApp();
      if (app.globalData) app.globalData.userProfile = safeProfile;
    } catch (e) {}

    this.setData({ showAuthModal: false }, () => {
      if (this.data.cardId) this.loadCard(this.data.cardId);
    });

    try {
      const app = getApp();
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const openid = app.globalData.openid || wx.getStorageSync('JISHIKA_OPENID');
        if (openid) {
          const db = wx.cloud.database();
          const res = await db.collection(collections.users)
            .where({ _openid: openid })
            .limit(1)
            .get();
          // 注意：_openid 是系统保留字段不允许写入，add 时云库自动填充
          const data = {
            nickName: safeProfile.nickname,
            avatarUrl: safeProfile.avatar,
            initial: safeProfile.initial,
            serviceTags: safeProfile.serviceTags,
            updatedAt: Date.now()
          };
          if (res.data && res.data[0] && res.data[0]._id) {
            await db.collection(collections.users).doc(res.data[0]._id).update({ data });
          } else {
            await db.collection(collections.users).add({
              data: { ...data, createdAt: Date.now() }
            });
          }
        }
      }
    } catch (error) {
      // 写云端失败：本地仍可用，但换设备/清缓存后会「被未授权」，提示用户稍后重试
      console.error('[finishAuth] 授权信息同步云端失败', error);
      wx.showToast({ title: '授权信息同步失败，请稍后重试', icon: 'none' });
    }
  },

  // 跳过授权：不影响已加入协作的结果，静默关闭
  closeAuthModal() {
    this.setData({ showAuthModal: false });
  },

  onPreventBubble() {},

  // 审批申请
  async approveRequest(e) {
    const requestId = e.currentTarget.dataset.id;
    const approved = e.currentTarget.dataset.approved;

    try {
      const res = await wx.cloud.callFunction({
        name: 'approveJoinRequest',
        data: { requestId, status: approved ? 'approved' : 'rejected' }
      });

      if (res.result && res.result.code === 0) {
        wx.showToast({ title: approved ? '已通过' : '已拒绝', icon: 'success' });
        this.loadCard(this.data.cardId);
      } else {
        wx.showToast({ title: res.result.message || '操作失败', icon: 'none' });
      }
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 选择截止日期（仅创立者 / 共同行动人，picker 已按权限禁用）
  onDeadlineChange(e) {
    const deadline = e.detail.value;
    if (!deadline || deadline === this.data.card.deadline) return;
    this.setCardDeadline(deadline);
  },

  async setCardDeadline(deadline) {
    const { cardId } = this.data;
    if (!cardId) return;

    try {
      const app = getApp();
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const res = await wx.cloud.callFunction({
          name: 'updateCard',
          data: { id: cardId, patch: { deadline } }
        });

        if (res.result && res.result.code === 0) {
          wx.showToast({ title: '日期已更新', icon: 'success' });
          this.loadCard(cardId);
        } else {
          wx.showToast({ title: (res.result && res.result.message) || '操作失败', icon: 'none' });
        }
        return;
      }

      await store.updateCard(cardId, { deadline });
      wx.showToast({ title: '日期已更新', icon: 'success' });
      this.loadCard(cardId);
    } catch (err) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // 点击状态胶囊，选择新状态（仅创立者 / 共同行动人）
  onStatusTap() {
    if (!this.data.canEditStatus) return;
    const labels = ['待确认', '进行中', '已完成'];
    const values = ['todo', 'doing', 'done'];
    wx.showActionSheet({
      itemList: labels,
      success: (res) => {
        const status = values[res.tapIndex];
        if (status) this.setCardStatus(status);
      }
    });
  },

  async setCardStatus(status) {
    const { cardId } = this.data;
    if (!cardId) return;

    try {
      const app = getApp();
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const res = await wx.cloud.callFunction({
          name: 'updateCard',
          data: { id: cardId, patch: { status } }
        });

        if (res.result && res.result.code === 0) {
          wx.showToast({ title: '状态已更新', icon: 'success' });
          this.loadCard(cardId);
        } else {
          wx.showToast({ title: (res.result && res.result.message) || '操作失败', icon: 'none' });
        }
        return;
      }

      await store.updateCard(cardId, { status });
      wx.showToast({ title: '状态已更新', icon: 'success' });
      this.loadCard(cardId);
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  // ==================== 编辑卡片（标题 / 描述 / 重点，创立者与共同行动人可用） ====================

  openEditSheet() {
    if (!this.data.canEditStatus) return;
    const { card, keyPoints } = this.data;
    this.setData({
      showEditSheet: true,
      editForm: {
        title: card.title || '',
        desc: card.desc || '',
        keyPointsText: (keyPoints || []).join(' · ')
      }
    });
  },

  closeEditSheet() {
    this.setData({ showEditSheet: false });
  },

  onEditTitleInput(e) {
    this.setData({ 'editForm.title': e.detail.value });
  },

  onEditDescInput(e) {
    this.setData({ 'editForm.desc': e.detail.value });
  },

  onEditKeyPointsInput(e) {
    this.setData({ 'editForm.keyPointsText': e.detail.value });
  },

  async submitEdit() {
    const { cardId, card, editForm } = this.data;
    if (!cardId) return;

    const title = (editForm.title || '').trim();
    if (!title) {
      wx.showToast({ title: '请输入标题', icon: 'none' });
      return;
    }

    const patch = {};
    if (title !== (card.title || '')) patch.title = title;
    const desc = editForm.desc || '';
    if (desc !== (card.desc || '')) patch.desc = desc;
    const keyPoints = (editForm.keyPointsText || '')
      .split('·')
      .map((item) => item.trim())
      .filter(Boolean);
    if (JSON.stringify(keyPoints) !== JSON.stringify(this.data.keyPoints)) {
      patch.keyPoints = keyPoints;
    }

    if (!Object.keys(patch).length) {
      this.closeEditSheet();
      return;
    }

    try {
      const app = getApp();
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const res = await wx.cloud.callFunction({
          name: 'updateCard',
          data: { id: cardId, patch }
        });

        if (res.result && res.result.code === 0) {
          wx.showToast({ title: '已保存', icon: 'success' });
          this.closeEditSheet();
          this.loadCard(cardId);
        } else {
          wx.showToast({ title: (res.result && res.result.message) || '保存失败', icon: 'none' });
        }
        return;
      }

      await store.updateCard(cardId, patch);
      wx.showToast({ title: '已保存', icon: 'success' });
      this.closeEditSheet();
      this.loadCard(cardId);
    } catch (err) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  // ==================== 协作记录 ====================

  openActivitySheet() {
    if (!this.data.isCreator && !this.data.isHelper) return;
    this.setData({ showActivitySheet: true });
    this.loadActivities();
  },

  closeActivitySheet() {
    this.setData({ showActivitySheet: false });
  },

  // 「…」圆：弹窗展示全部共同行动人
  openHelpersSheet() {
    this.setData({ showHelpersSheet: true });
  },

  closeHelpersSheet() {
    this.setData({ showHelpersSheet: false });
  },

  async loadActivities() {
    const { cardId } = this.data;
    if (!cardId) return;

    const app = getApp();
    if (!(app.globalData && app.globalData.cloudReady) || !wx.cloud) {
      this.setData({ activities: [], activitiesLoading: false });
      wx.showToast({ title: '协作记录需要云开发环境', icon: 'none' });
      return;
    }

    this.setData({ activitiesLoading: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getCardActivities',
        data: { cardId }
      });

      if (res.result && res.result.code === 0) {
        const activities = (res.result.data || []).map((item) => ({
          id: item._id,
          actorName: item.actorName || '未知用户',
          actorAvatar: item.actorAvatar || '',
          actorInitial: getInitial(item.actorName),
          detail: item.detail || '',
          timeText: this.formatActivityTime(item.createdAt)
        }));
        this.setData({ activities, activitiesLoading: false });
      } else {
        this.setData({ activities: [], activitiesLoading: false });
        wx.showToast({ title: (res.result && res.result.message) || '加载失败', icon: 'none' });
      }
    } catch (e) {
      this.setData({ activities: [], activitiesLoading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  // 协作记录时间格式：MM-DD HH:mm
  formatActivityTime(ts) {
    if (!ts) return '';
    const date = new Date(ts);
    const mm = `${date.getMonth() + 1}`.padStart(2, '0');
    const dd = `${date.getDate()}`.padStart(2, '0');
    const hh = `${date.getHours()}`.padStart(2, '0');
    const mi = `${date.getMinutes()}`.padStart(2, '0');
    return `${mm}-${dd} ${hh}:${mi}`;
  },

  // ==================== 保存卡片（海报） ====================

  async onSavePoster() {
    if (this.savingPoster) return;
    this.savingPoster = true;
    wx.showLoading({ title: '生成卡片中', mask: true });

    try {
      const qrSrc = await this.fetchQrCodeSrc();
      const filePath = await this.drawPoster(qrSrc);
      await new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject });
      });
      wx.hideLoading();
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (e) {
      wx.hideLoading();
      const errMsg = (e && e.errMsg) || '';
      if (/auth|deny/i.test(errMsg)) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许保存图片到相册',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) wx.openSetting();
          }
        });
      } else if (!/cancel/i.test(errMsg)) {
        console.error('onSavePoster error', e);
        wx.showToast({ title: '生成失败，请重试', icon: 'none' });
      }
    } finally {
      this.savingPoster = false;
    }
  },

  // 拉取小程序码临时文件；云端不可用或生成失败时返回 null（海报走降级）
  async fetchQrCodeSrc() {
    const { refCode } = this.data;
    if (!refCode) return null;
    try {
      const app = getApp();
      if (!(app.globalData && app.globalData.cloudReady) || !wx.cloud) return null;

      const res = await wx.cloud.callFunction({
        name: 'getCardQrCode',
        data: { code: refCode }
      });
      const base64 = res.result && res.result.code === 0 ? res.result.qrcodeBase64 : '';
      if (!base64) return null;

      const filePath = `${wx.env.USER_DATA_PATH}/jishika_qr_${refCode}.jpg`;
      await new Promise((resolve, reject) => {
        wx.getFileSystemManager().writeFile({
          filePath,
          data: base64,
          encoding: 'base64',
          success: resolve,
          fail: reject
        });
      });
      return filePath;
    } catch (e) {
      console.warn('fetchQrCodeSrc fallback', e);
      return null;
    }
  },

  drawPoster(qrSrc) {
    const { card, creator, statusText, keyPoints, refCode } = this.data;
    const W = 750;
    const H = 1120;

    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select('#posterCanvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          (async () => {
            try {
              const node = res && res[0] && res[0].node;
              if (!node) throw new Error('canvas node not found');
              const ctx = node.getContext('2d');
              const sys = wx.getSystemInfoSync();
              const dpr = Math.min(sys.pixelRatio || 2, 3);
              node.width = W * dpr;
              node.height = H * dpr;
              ctx.scale(dpr, dpr);

              const roundRect = (x, y, w, h, r) => {
                ctx.beginPath();
                ctx.moveTo(x + r, y);
                ctx.arcTo(x + w, y, x + w, y + h, r);
                ctx.arcTo(x + w, y + h, x, y + h, r);
                ctx.arcTo(x, y + h, x, y, r);
                ctx.arcTo(x, y, x + w, y, r);
                ctx.closePath();
              };

              const wrapText = (text, maxWidth, maxLines) => {
                const lines = [];
                let line = '';
                let truncated = false;
                for (const ch of String(text || '')) {
                  if (ch === '\n' || ctx.measureText(line + ch).width > maxWidth) {
                    lines.push(line);
                    line = ch === '\n' ? '' : ch;
                    if (lines.length === maxLines) { truncated = true; break; }
                  } else {
                    line += ch;
                  }
                }
                if (!truncated && line) lines.push(line);
                if (truncated && lines.length) lines[lines.length - 1] += '…';
                return lines;
              };

              // 背景
              ctx.fillStyle = '#f0f5ee';
              ctx.fillRect(0, 0, W, H);

              // 品牌行
              ctx.textBaseline = 'alphabetic';
              ctx.textAlign = 'left';
              ctx.fillStyle = '#2f7a3d';
              ctx.font = 'bold 34px sans-serif';
              ctx.fillText('记事卡', 48, 80);
              ctx.textAlign = 'right';
              ctx.fillStyle = '#8a978a';
              ctx.font = '22px sans-serif';
              ctx.fillText(card.updatedText ? `更新于 ${card.updatedText}` : '', W - 48, 80);

              // 相纸
              ctx.save();
              ctx.shadowColor = 'rgba(21, 71, 40, 0.16)';
              ctx.shadowBlur = 24;
              ctx.shadowOffsetY = 8;
              ctx.fillStyle = '#ffffff';
              roundRect(48, 110, W - 96, 792, 6);
              ctx.fill();
              ctx.restore();

              // 药膜
              ctx.fillStyle = '#edf1e9';
              roundRect(72, 134, W - 144, 618, 4);
              ctx.fill();

              const filmX = 104;
              const filmW = W - 144 - 64;
              let y = 134 + 58;

              // 状态胶囊（右上）
              ctx.font = 'bold 22px sans-serif';
              const stW = ctx.measureText(statusText).width + 36;
              ctx.fillStyle = '#e8f5e9';
              roundRect(W - 104 - stW, y - 28, stW, 40, 20);
              ctx.fill();
              ctx.fillStyle = '#43a047';
              ctx.textAlign = 'center';
              ctx.fillText(statusText, W - 104 - stW / 2, y);

              // 标题（≤2 行）
              ctx.textAlign = 'left';
              ctx.fillStyle = '#162116';
              ctx.font = 'bold 36px sans-serif';
              wrapText(card.title || '未命名事项', filmW - stW - 16, 2)
                .forEach((line) => {
                  ctx.fillText(line, filmX, y);
                  y += 48;
                });
              y = Math.max(y, 134 + 58 + 48);
              y += 18;

              // 虚线
              ctx.setLineDash([8, 6]);
              ctx.strokeStyle = '#cfd8cc';
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(filmX, y);
              ctx.lineTo(filmX + filmW, y);
              ctx.stroke();
              ctx.setLineDash([]);
              y += 38;

              // 需求描述（≤4 行）
              if (card.desc) {
                ctx.fillStyle = '#5a6355';
                ctx.font = '24px sans-serif';
                wrapText(card.desc, filmW, 4).forEach((line) => {
                  ctx.fillText(line, filmX, y);
                  y += 38;
                });
                y += 14;
              }

              // 重点 / 待确认（≤3 条）
              (keyPoints || []).slice(0, 3).forEach((kp) => {
                ctx.fillStyle = '#b57a00';
                ctx.font = '22px sans-serif';
                wrapText(`· ${kp}`, filmW, 1).forEach((line) => {
                  ctx.fillText(line, filmX, y);
                  y += 34;
                });
              });

              // 药膜底部：创立者 + 截止日期
              const filmBottomY = 134 + 618 - 30;
              ctx.fillStyle = '#8a978a';
              ctx.font = '22px sans-serif';
              ctx.textAlign = 'left';
              ctx.fillText(`创立者 ${(creator && creator.nickname) || '未知用户'}`, filmX, filmBottomY);
              ctx.textAlign = 'right';
              ctx.fillText(`截止 ${card.deadline || '未设置'}`, filmX + filmW, filmBottomY);

              // 相纸下白边：编号 + 口令提示
              ctx.textAlign = 'center';
              ctx.fillStyle = '#2c3a2e';
              ctx.font = 'bold 28px monospace';
              ctx.fillText(`记事卡 #${refCode || '------'}`, W / 2, 842);
              ctx.fillStyle = '#a9b3a6';
              ctx.font = '19px sans-serif';
              ctx.fillText('发给微信 AI 说「打开这张卡」', W / 2, 874);

              // 小程序码区（降级：虚线框 + 大字短码）
              const qrY = 936;
              const qrSize = 140;
              if (qrSrc) {
                const img = node.createImage();
                await new Promise((resImg, rejImg) => {
                  img.onload = resImg;
                  img.onerror = rejImg;
                  img.src = qrSrc;
                });
                ctx.drawImage(img, 48, qrY, qrSize, qrSize);
              } else {
                ctx.save();
                ctx.setLineDash([10, 8]);
                ctx.strokeStyle = '#b6c2b4';
                ctx.lineWidth = 2;
                roundRect(48, qrY, qrSize, qrSize, 12);
                ctx.stroke();
                ctx.restore();
                ctx.fillStyle = '#2c3a2e';
                ctx.font = 'bold 30px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(`#${refCode || '------'}`, 48 + qrSize / 2, qrY + qrSize / 2 + 10);
              }

              // 码右侧说明
              ctx.textAlign = 'left';
              ctx.fillStyle = '#162116';
              ctx.font = 'bold 26px sans-serif';
              ctx.fillText('微信扫一扫，或把口令发给微信 AI', 48 + qrSize + 28, qrY + 44);
              ctx.fillStyle = '#5a6355';
              ctx.font = '23px sans-serif';
              ctx.fillText(`口令：记事卡 #${refCode || '------'}`, 48 + qrSize + 28, qrY + 86);
              ctx.fillStyle = '#8a978a';
              ctx.font = '20px sans-serif';
              ctx.fillText('AI 将读取本卡的结构化内容', 48 + qrSize + 28, qrY + 122);

              wx.canvasToTempFilePath({
                canvas: node,
                success: (r) => resolve(r.tempFilePath),
                fail: reject
              });
            } catch (err) {
              reject(err);
            }
          })();
        });
    });
  },

  // 卡片渲染完成：生成路径下，卡片浮现瞬间播放「卡叽」音效
  onCardRendered() {
    if (!this.fromCreate) return;
    this.fromCreate = false;
    setTimeout(() => this.playDropSound(), 200);
  },

  playDropSound() {
    try {
      if (!this.dropAudio) {
        this.dropAudio = wx.createInnerAudioContext();
        this.dropAudio.src = '/assets/audio/invite-click.wav';
      }
      this.dropAudio.stop();
      this.dropAudio.play();
    } catch (e) {}
    try {
      wx.vibrateShort({ type: 'light' });
    } catch (e) {}
  },

  onShareAppMessage() {
    const { card, refCode, myJoinStatus, myJoinRequestId } = this.data;
    // 待引荐状态：分享即「请好友帮我引荐」，path 携带申请 ID（endorse）
    if (myJoinStatus === 'pending_intermediary' && myJoinRequestId && card.id) {
      return {
        title: `帮我在《${card.title || '记事卡'}》里引荐一下`,
        path: `/pages/card-detail/card-detail?id=${card.id}&endorse=${myJoinRequestId}`,
        imageUrl: '/assets/logo.png'
      };
    }
    const title = card.title
      ? `邀请你一起用《${card.title}》`
      : '邀请你一起用记事卡';
    let path = '/pages/home/home';
    if (refCode) {
      path = `/pages/card-detail/card-detail?ref=${refCode}`;
    } else if (card.id) {
      path = `/pages/card-detail/card-detail?id=${card.id}`;
    }
    return {
      title,
      path,
      imageUrl: '/assets/logo.png'
    };
  }
});
