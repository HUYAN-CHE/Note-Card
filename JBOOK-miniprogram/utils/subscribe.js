// 订阅消息额度：每次微信授权成功，云函数 subscribeReminder 给 users.subscribeCount +1
// 授权模板 ID 配置在 app.globalData.reminderTemplateIds，未配置时直接累计（打通链路）
async function accumulate(extra) {
  try {
    const res = await wx.cloud.callFunction({
      name: 'subscribeReminder',
      data: { action: 'subscribe', ...(extra || {}) }
    });
    return res.result && res.result.code === 0 && res.result.data ? res.result.data : null;
  } catch (e) {
    return null;
  }
}

// 弹微信订阅授权，接受才累计；resolve 为最新额度数据（{ count }）或 null（未授权/失败）
function requestSubscribeCredit(extra) {
  const app = getApp();
  if (!app.globalData || !app.globalData.cloudReady || !wx.cloud) {
    return Promise.resolve(null);
  }
  const tmplIds = (app.globalData.reminderTemplateIds || []).filter(Boolean);
  if (!tmplIds.length) {
    return accumulate(extra);
  }
  return new Promise((resolve) => {
    wx.requestSubscribeMessage({
      tmplIds,
      success: async (res) => {
        const accepted = tmplIds.some((id) => res[id] === 'accept');
        resolve(accepted ? await accumulate(extra) : null);
      },
      fail: () => resolve(null)
    });
  });
}

module.exports = { requestSubscribeCredit };
