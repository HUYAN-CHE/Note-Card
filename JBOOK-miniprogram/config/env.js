module.exports = {
  enableCloud: true,
  cloudEnvId: 'cloud1-d3gsqteqm9c3866ac',
  // 审核版开关：true 时隐藏未完整上线的会员功能入口（会员 banner、灵感页会员引导），
  // 过审后改回 false 即恢复完整版
  reviewMode: false,
  // 会员档位（member 页档位卡片 / admin grant / 虚拟支付用；价格单位元，priceFen 单位分）
  // productId/priceFen 必须与微信公众平台虚拟支付后台道具一致；
  // 改价时同步修改 cloudfunctions/virtualPayment/config.js 的 plans
  membershipPlans: [
    { plan: 'monthly', label: '罐头月卡', price: 19, days: 30, productId: 'member_monthly', priceFen: 1900 },
    { plan: 'yearly', label: '罐头年卡', price: 199, days: 365, productId: 'member_yearly', priceFen: 19900 },
    { plan: 'lifetime', label: '罐头创始卡', price: 299, days: 0, productId: 'member_founder', priceFen: 29900 },
    // 测试档位：1 元道具「猫条」，仅供支付链路开发自测，hidden 标记页面不展示
    { plan: 'test', label: '猫条', price: 1, days: 1, productId: 'test_item', priceFen: 100, hidden: true }
  ],
  // 企微「联系我」插件（member 页添加私人助理按钮）
  wecom: { contactPluginId: '0a45e709f9fca07a8ac292708f7000a1' },
  collections: {
    cards: 'cards',
    users: 'users',
    relationships: 'relationships',
    joinRequests: 'joinRequests',
    messages: 'messages'
  }
};
