// 虚拟支付配置模板：复制为 config.js 并填入真实凭证（config.js 已被 .gitignore 忽略，切勿提交真实密钥）
module.exports = {
  payEnv: Number(process.env.PAY_ENV || 0), // 1=沙箱 0=现网
  offerId: process.env.VP_OFFER_ID || '',
  appKeySandbox: process.env.VP_APPKEY_SANDBOX || '',
  appKeyProd: process.env.VP_APPKEY_PROD || '',
  appSecret: process.env.VP_APP_SECRET || '',
  appId: process.env.VP_APP_ID || '',
  systemKey: process.env.PAY_SYSTEM_KEY || '',
  plans: {
    test: { productId: 'test_item', priceFen: 100, label: '猫条' },
    monthly: { productId: 'member_monthly', priceFen: 1900, label: '罐头月卡' },
    yearly: { productId: 'member_yearly', priceFen: 19900, label: '罐头年卡' },
    lifetime: { productId: 'member_founder', priceFen: 29900, label: '罐头创始卡' }
  }
};
