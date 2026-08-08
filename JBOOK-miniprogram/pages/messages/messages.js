const { getNavInfo } = require('../../utils/ui');

// 消息类型展示配置：色点颜色（未读时左侧绿点另行标识）
const TYPE_META = {
  card_expired: { label: '卡片', color: '#ff9500' },
  reminder: { label: '提醒', color: '#00c853' },
  join_request: { label: '申请', color: '#2e7d4e' },
  join_result: { label: '结果', color: '#5c8dff' },
  member: { label: '会员', color: '#c9a227' }
};

// 相对时间：刚刚 / N分钟前 / N小时前 / 昨天 / N天前 / 日期
function formatRelativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / 3600000)}小时前`;

  const d = new Date(ts);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= dayStart - 24 * 3600 * 1000) return '昨天';

  const days = Math.floor((dayStart - ts) / (24 * 3600 * 1000)) + 1;
  if (days < 30) return `${days}天前`;

  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

Page({
  data: {
    statusBarHeight: 44,
    navHeight: 88,
    totalHeight: 132,
    loading: true,
    list: []
  },

  onLoad() {
    const navInfo = getNavInfo();
    this.setData({
      statusBarHeight: navInfo.statusBarHeight,
      navHeight: navInfo.navHeight,
      totalHeight: navInfo.totalHeight
    });
  },

  onShow() {
    this.loadMessages();
  },

  async loadMessages() {
    this.setData({ loading: true });
    try {
      const res = await wx.cloud.callFunction({ name: 'getMyMessages' });
      const data = (res.result && res.result.data) || {};
      const list = (data.list || []).map((item) => {
        const meta = TYPE_META[item.type] || { label: '消息', color: '#999999' };
        return {
          ...item,
          typeLabel: meta.label,
          typeColor: meta.color,
          timeText: formatRelativeTime(item.createdAt)
        };
      });
      this.setData({ list, loading: false });
      this.markAllRead();
    } catch (error) {
      this.setData({ list: [], loading: false });
    }
  },

  // 渲染后全部置为已读：云端标记 + 本地清掉未读点
  async markAllRead() {
    const hasUnread = this.data.list.some((item) => !item.read);
    if (!hasUnread) return;
    this.setData({
      list: this.data.list.map((item) => ({ ...item, read: true }))
    });
    try {
      await wx.cloud.callFunction({
        name: 'markMessagesRead',
        data: { all: true }
      });
    } catch (error) {
      // 标记失败不影响展示，下次进入会重试
    }
  },

  onMessageTap(event) {
    const item = event.currentTarget.dataset.item;
    if (!item) return;

    // reminder 类型无落地页，仅标记已读不跳转
    if (
      (item.type === 'card_expired' || item.type === 'join_request' || item.type === 'join_result') &&
      item.cardId
    ) {
      wx.navigateTo({
        url: `/pages/card-detail/card-detail?id=${item.cardId}`
      });
      return;
    }

    if (item.type === 'member') {
      wx.navigateTo({ url: '/pages/member/member' });
    }
  }
});
