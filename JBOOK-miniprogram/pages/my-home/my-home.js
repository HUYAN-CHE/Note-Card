const store = require('../../utils/store.js');
const { getNavInfo } = require('../../utils/ui');
const { resolveThemeIcon } = require('../../utils/theme-icon');
const { collections } = require('../../config/env');
const { listInspireCards } = require('../../services/inspire-cards');

const DEFAULT_CANDIDATE_TAGS = ['法律咨询', '财务规划', '职业规划', '心理咨询', '编程开发', '设计创意', '文案写作', '摄影摄像', '健身指导', '家庭教育', '房产顾问', '留学移民'];
const AUTH_PROFILE_KEY = 'JISHIKA_USER_PROFILE';

const STATUS_TEXT = {
  draft: '待确认',
  todo: '待确认',
  doing: '进行中',
  done: '已完成'
};

const STATUS_CLASSES = {
  draft: 'status-pending',
  todo: 'status-pending',
  doing: 'status-doing',
  done: 'status-done'
};

function cleanNickname(name) {
  if (!name || String(name).trim() === '我') return '';
  return String(name).trim();
}

function cleanInitial(initial, name) {
  if (!initial || String(initial).trim() === '我') return getInitial(name);
  return String(initial).trim();
}

function getInitial(name) {
  if (!name) return '';
  return String(name).trim().charAt(0).toUpperCase();
}

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    heroPaddingTop: 132,
    user: { nickname: '', avatar: '', initial: '' },
    serviceTags: [],
    candidateTags: [],
    tagInput: '',
    tagEditing: false,
    activeTab: 'pending',
    allCards: [],
    cards: [],
    counts: { pending: 0, doing: 0, done: 0, helped: 0 },
    inspireTab: 'collecting',
    previewCards: [],
    exportedCards: [],
    // 灵感卡（真实数据，onShow 从云端加载，按状态拆分 集灵中/已输出）
    inspireCards: [],
    // 会员状态：none 未开通 / active 有效期中 / expired 已过期
    memberStatus: 'none',
    memberExpireText: '',
    memberDaysLeft: 0,
    // 管理员标识：true 时右上角菜单出现「会员管理」入口
    isAdmin: false,
    loading: false,
    emptyText: '还没有记事卡'
  },

  onLoad() {
    const navInfo = getNavInfo();
    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight,
      heroPaddingTop: navInfo.totalHeight + 24
    });
    this.loadData();
  },

  onShow() {
    this.loadData();
    this.loadInspireCards();
    this.loadMembershipStatus();
    this.checkAdmin();
  },

  // 管理员标识：决定右上角菜单是否出现「会员管理」入口
  checkAdmin() {
    if (!wx.cloud) return;
    wx.cloud.callFunction({ name: 'membership', data: { action: 'checkAdmin' } })
      .then((res) => {
        const d = (res.result && res.result.data) || {};
        this.setData({ isAdmin: !!d.isAdmin });
      })
      .catch(() => {});
  },

  // 会员状态：驱动会员卡 banner 文案（未开通/有效期中/已过期）
  loadMembershipStatus() {
    if (!wx.cloud) return;
    wx.cloud.callFunction({ name: 'membership', data: { action: 'getStatus' } })
      .then((res) => {
        const d = (res.result && res.result.data) || {};
        this.setData({
          memberStatus: d.status || 'none',
          memberDaysLeft: d.daysLeft || 0,
          memberExpireText: d.expireAt ? this.formatMemberDate(d.expireAt) : ''
        });
      })
      .catch((e) => console.warn('loadMembershipStatus error', e));
  },

  formatMemberDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  // 灵感卡：集灵中/已输出 按状态拆分，横滑最多展示 5 个，更多进三级页铺开
  loadInspireCards() {
    listInspireCards(true)
      .then((cards) => {
        const collecting = cards.filter((c) => c.status === 'collecting');
        this.setData({
          inspireCards: collecting,
          exportedCards: cards.filter((c) => c.status === 'exported'),
          previewCards: collecting.slice(0, 5)
        });
      })
      .catch((e) => console.warn('loadInspireCards error', e));
  },

  // 点击灵感卡，进入可编辑的文章页（带上列表着色，保持视觉连续）
  openInspireDetail(e) {
    const { id, color } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({ url: `/pages/inspire-detail/inspire-detail?id=${id}&color=${encodeURIComponent(color || '')}` });
  },

  async loadData() {
    this.setData({ loading: true });
    // 先用本地授权信息立即渲染，避免云端返回前闪出「未授权」占位
    const localProfile = this.loadAuthProfile();
    if (localProfile.nickname || localProfile.avatar) {
      this.setData({
        user: {
          nickname: localProfile.nickname,
          avatar: localProfile.avatar || '',
          initial: localProfile.initial
        }
      });
    }
    try {
      const app = getApp();
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const res = await wx.cloud.callFunction({ name: 'getMyHomeData' });
        if (res.result && res.result.code === 0) {
          this.renderData(res.result.data);
          return;
        }
      }
      await this.loadLocalData();
    } catch (e) {
      await this.loadLocalData();
    } finally {
      this.setData({ loading: false });
    }
  },

  renderData(data) {
    const cloudProfile = data.profile || {};
    const authProfile = this.loadAuthProfile();

    const nickname = cleanNickname(cloudProfile.nickname) || cleanNickname(authProfile.nickname);
    const avatar = cloudProfile.avatar || authProfile.avatar || '';
    const initial = cleanInitial(cloudProfile.initial, nickname) || cleanInitial(authProfile.initial, nickname);

    const serviceTags = Array.isArray(cloudProfile.serviceTags)
      ? cloudProfile.serviceTags
      : (Array.isArray(authProfile.serviceTags) ? authProfile.serviceTags : []);

    const candidateTags = (data.candidateTags || DEFAULT_CANDIDATE_TAGS)
      .filter((t) => !serviceTags.includes(t));

    this.setData({
      user: { nickname, avatar, initial },
      serviceTags,
      candidateTags,
      allCards: data.allCards || []
    }, () => {
      this.refreshCards();
    });
  },

  async loadLocalData() {
    const profile = this.loadAuthProfile();
    const serviceTags = Array.isArray(profile.serviceTags) ? profile.serviceTags : [];
    const candidateTags = DEFAULT_CANDIDATE_TAGS.filter((t) => !serviceTags.includes(t));
    const allCards = await store.getCards() || [];

    this.setData({
      user: {
        nickname: cleanNickname(profile.nickname),
        avatar: profile.avatar || '',
        initial: cleanInitial(profile.initial, profile.nickname)
      },
      serviceTags,
      candidateTags,
      allCards
    }, () => {
      this.refreshCards();
    });
  },

  loadAuthProfile() {
    const app = getApp();
    const globalProfile = app.globalData && app.globalData.userProfile;
    const localProfile = wx.getStorageSync(AUTH_PROFILE_KEY);
    const cached = globalProfile || localProfile;
    const fallback = { nickname: '', avatar: '', serviceTags: [] };
    const profile = (cached && typeof cached === 'object') ? cached : fallback;
    return {
      nickname: cleanNickname(profile.nickname),
      avatar: profile.avatar || '',
      initial: cleanInitial(profile.initial, profile.nickname),
      serviceTags: Array.isArray(profile.serviceTags) ? profile.serviceTags : []
    };
  },

  // 卡片 creatorId/helperIds 可能存 openid 或昵称，两个都认
  getMyIds() {
    const ids = [];
    if (this.data.user.nickname) ids.push(this.data.user.nickname);
    const openid = store.getCurrentOpenid();
    if (openid) ids.push(openid);
    return ids;
  },

  isMine(card, myIds) {
    return !card.creatorId || myIds.includes(card.creatorId);
  },

  isHelped(card, myIds) {
    return Array.isArray(card.helperIds) && card.helperIds.some((id) => myIds.includes(id));
  },

  // 统计 4 个 tab 的数量
  computeCounts(allCards, myIds) {
    const mine = allCards.filter((c) => this.isMine(c, myIds));
    return {
      pending: mine.filter((c) => c.status === 'draft' || c.status === 'todo').length,
      doing: mine.filter((c) => c.status === 'doing').length,
      done: mine.filter((c) => c.status === 'done').length,
      helped: allCards.filter((c) => this.isHelped(c, myIds)).length
    };
  },

  // 与首页一致的卡片展示字段
  decorateCard(card) {
    const title = (card.title || '').trim() || '未命名事项';
    return {
      ...card,
      icon: resolveThemeIcon(card),
      displayTitle: title.length > 10 ? title.slice(0, 10) + '…' : title,
      statusText: STATUS_TEXT[card.status] || '待确认',
      statusClass: STATUS_CLASSES[card.status] || 'status-pending',
      deadlineText: card.deadline || '未设置'
    };
  },

  refreshCards() {
    const { activeTab, allCards = [] } = this.data;
    const myIds = this.getMyIds();
    let filtered = [];
    let emptyText = '还没有记事卡';

    if (activeTab === 'pending') {
      filtered = allCards.filter((c) => this.isMine(c, myIds) && (c.status === 'draft' || c.status === 'todo'));
      emptyText = '还没有待确定的记事卡';
    } else if (activeTab === 'doing') {
      filtered = allCards.filter((c) => this.isMine(c, myIds) && c.status === 'doing');
      emptyText = '还没有进行中的记事卡';
    } else if (activeTab === 'done') {
      filtered = allCards.filter((c) => this.isMine(c, myIds) && c.status === 'done');
      emptyText = '还没有已完成的记事卡';
    } else if (activeTab === 'helped') {
      filtered = allCards.filter((c) => this.isHelped(c, myIds));
      emptyText = '还没有协助过别人的记事卡';
    }

    this.setData({
      cards: filtered.map((c) => this.decorateCard(c)),
      counts: this.computeCounts(allCards, myIds),
      emptyText
    });
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab }, () => this.refreshCards());
  },

  // 灵感卡 tab：集灵中 / 已输出
  switchInspireTab(e) {
    this.setData({ inspireTab: e.currentTarget.dataset.tab });
  },

  // 横滑超过 5 个，进三级页铺开全部灵感卡
  openInspireList() {
    wx.navigateTo({ url: '/pages/inspire-list/inspire-list' });
  },

  // 会员卡：进会员页（状态/权益/开通引导）
  onMemberTap() {
    wx.navigateTo({ url: '/pages/member/member' });
  },

  // 右上角箭头：管理员含「会员管理」入口，其余为退出登录
  onLogoutTap() {
    const items = this.data.isAdmin ? ['会员管理', '退出登录'] : ['退出登录'];
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        if (items[res.tapIndex] === '会员管理') {
          wx.navigateTo({ url: '/pages/admin/admin' });
        } else if (items[res.tapIndex] === '退出登录') {
          this.logout();
        }
      }
    });
  },

  async logout() {
    wx.removeStorageSync(AUTH_PROFILE_KEY);
    try {
      getApp().globalData.userProfile = null;
    } catch (e) {}
    // 清云端授权信息（否则 checkAuth 云端回源又会拉回，等于没退出）
    try {
      const app = getApp();
      if (app.globalData && app.globalData.cloudReady && wx.cloud) {
        const openid = app.globalData.openid || wx.getStorageSync('JISHIKA_OPENID');
        if (openid) {
          const db = wx.cloud.database();
          const res = await db.collection(collections.users).where({ _openid: openid }).limit(1).get();
          if (res.data && res.data[0]) {
            await db.collection(collections.users).doc(res.data[0]._id).update({
              data: { nickName: '', avatarUrl: '', initial: '', updatedAt: Date.now() }
            });
          }
        }
      }
    } catch (e) {}
    wx.reLaunch({ url: '/pages/home/home' });
  },

  toggleTagEdit() {
    this.setData({ tagEditing: !this.data.tagEditing });
  },

  onTagInput(e) {
    this.setData({ tagInput: e.detail.value });
  },

  addTag(e) {
    const value = (e.detail.value || this.data.tagInput || '').trim();
    if (!value) return;
    this.addTagCore(value);
  },

  addCandidateTag(e) {
    this.addTagCore(e.currentTarget.dataset.tag);
  },

  addTagCore(value) {
    const { serviceTags } = this.data;
    if (serviceTags.includes(value)) {
      wx.showToast({ title: '标签已存在', icon: 'none' });
      return;
    }
    if (serviceTags.length >= 8) {
      wx.showToast({ title: '最多 8 个标签', icon: 'none' });
      return;
    }
    const next = [...serviceTags, value];
    const candidateTags = DEFAULT_CANDIDATE_TAGS.filter((t) => !next.includes(t));
    this.setData({ serviceTags: next, candidateTags, tagInput: '' });
  },

  removeTag(e) {
    const index = e.currentTarget.dataset.index;
    const next = [...this.data.serviceTags];
    next.splice(index, 1);
    const candidateTags = DEFAULT_CANDIDATE_TAGS.filter((t) => !next.includes(t));
    this.setData({ serviceTags: next, candidateTags });
  },

  openCard(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/card-detail/card-detail?id=${id}&view=owner` });
  }
});
