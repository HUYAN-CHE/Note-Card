module.exports = {
  enableCloud: true,
  cloudEnvId: 'cloud1-d3gsqteqm9c3866ac',
  // 审核版开关：true 时隐藏未完整上线的会员功能入口（会员 banner、灵感页会员引导），
  // 过审后改回 false 即恢复完整版
  reviewMode: false,
  collections: {
    cards: 'cards',
    users: 'users',
    relationships: 'relationships',
    joinRequests: 'joinRequests'
  }
};
