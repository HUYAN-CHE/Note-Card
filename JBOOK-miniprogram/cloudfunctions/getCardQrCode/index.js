const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

// 生成带短码的小程序码，供「保存卡片」海报使用
// envVersion 固定 develop（未发布期）；正式发布后改为 release
exports.main = async (event, context) => {
  const { code } = event;
  if (!code || typeof code !== 'string') {
    return { code: -2, message: '缺少卡片短码' };
  }

  try {
    const res = await cloud.openapi.wxacode.getUnlimited({
      scene: `r=${code.trim().toUpperCase()}`.slice(0, 32),
      page: 'pages/card-detail/card-detail',
      checkPath: false,
      envVersion: 'develop',
      width: 280
    });

    if (!res || !res.buffer) {
      return { code: -4, message: '小程序码生成失败' };
    }

    return {
      code: 0,
      message: 'success',
      qrcodeBase64: res.buffer.toString('base64'),
      contentType: res.contentType || 'image/jpeg'
    };
  } catch (error) {
    return { code: -5, message: error.message || '小程序码生成失败' };
  }
};
