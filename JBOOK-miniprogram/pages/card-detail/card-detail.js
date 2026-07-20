const store = require('../../utils/store.js');
const { getNavInfo } = require('../../utils/ui');

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
    canAcceptInvite: false,
    showApplySheet: false,
    applyMessage: '',
    pendingRequests: [],
    loading: false,
    safeAreaBottom: 0,
    cardReady: false,
    canEditStatus: false,
    refCode: '',
    developing: false
  },

  onLoad(options) {
    const sys = wx.getSystemInfoSync();
    const navInfo = getNavInfo();
    // iPhone Home 指示条安全区兜底：safeAreaInsets 缺失时用 safeArea 计算
    const safeBottom = sys.safeAreaInsets
      ? sys.safeAreaInsets.bottom
      : Math.max(0, sys.screenHeight - ((sys.safeArea && sys.safeArea.bottom) || sys.screenHeight));

    // 从「生成记事卡」跳转而来时，播放拍立得出片 + 显影动画
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

    if (cardId) {
      this.setData({ cardId });
      this.loadCard(cardId);
    } else if (refCode) {
      this.loadCardByRef(refCode);
    } else {
      wx.showToast({ title: '缺少卡片ID', icon: 'none' });
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

  renderCard(data) {
    const role = data.role || 'stranger';
    const isCreator = role === 'creator';
    const isHelper = role === 'helper';
    const isNetworkView = role === 'network';

    const statusInfo = STATUS_MAP[data.status] || { text: data.status || '进行中', class: 'doing' };
    const keyPoints = Array.isArray(data.keyPoints) ? data.keyPoints : [];

    this.setData({
      card: data,
      creator: data.creator || this.data.creator,
      helpers: data.helpers || [],
      keyPoints,
      statusClass: statusInfo.class,
      statusText: statusInfo.text,
      isOverdue: checkOverdue(data),
      role,
      isCreator,
      isHelper,
      isNetworkView,
      canAcceptInvite: role === 'stranger' && !isNetworkView,
      pendingRequests: data.pendingRequests || [],
      cardReady: true,
      canEditStatus: isCreator || isHelper,
      refCode: data.refCode || ''
    }, () => {
      this.onCardRendered();
      this.ensureRefCode(data);
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

    this.setData({
      card,
      creator,
      helpers,
      keyPoints,
      statusClass: statusInfo.class,
      statusText: statusInfo.text,
      isOverdue: checkOverdue(card),
      role: isCreator ? 'creator' : (isHelper ? 'helper' : 'stranger'),
      isCreator,
      isHelper,
      isNetworkView: false,
      canAcceptInvite: !isCreator && !isHelper,
      pendingRequests: [],
      cardReady: true,
      canEditStatus: isCreator || isHelper,
      refCode: card.refCode || ''
    }, () => {
      this.onCardRendered();
      this.ensureRefCode(card);
    });
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
      }
    } catch (e) {}
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
    const { cardId, applyMessage } = this.data;
    if (!cardId) return;

    try {
      const res = await wx.cloud.callFunction({
        name: 'applyToJoinCard',
        data: { cardId, note: applyMessage }
      });

      if (res.result && res.result.code === 0) {
        wx.showToast({ title: '申请已提交', icon: 'success' });
        this.closeApplySheet();
      } else {
        wx.showToast({ title: res.result.message || '申请失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '申请失败', icon: 'none' });
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
      } else {
        wx.showToast({ title: res.result.message || '加入失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '加入失败', icon: 'none' });
    }
  },

  // 审批申请
  async approveRequest(e) {
    const requestId = e.currentTarget.dataset.id;
    const approved = e.currentTarget.dataset.approved;

    try {
      const res = await wx.cloud.callFunction({
        name: 'approveJoinRequest',
        data: { requestId, approved }
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
          data: { id: cardId, status }
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

  // 共同行动人「添加」：唤起分享菜单
  inviteFriend() {
    wx.showShareMenu({ withShareTicket: true });
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

  // 卡片渲染完成：生成路径下，相纸落点瞬间播放「卡叽」音效
  onCardRendered() {
    if (!this.fromCreate) return;
    this.fromCreate = false;
    setTimeout(() => this.playDropSound(), 720);
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
    const { card, refCode } = this.data;
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
