// 头像上传云存储：chooseAvatar 返回的是临时文件路径（重启后失效），
// 统一上传云存储换 cloud:// fileID 再持久化。失败返回空串（调用方可用临时路径兜底当次会话）
async function uploadAvatar(tempUrl) {
  if (!tempUrl) return '';
  try {
    const app = getApp();
    if (!app.globalData || !app.globalData.cloudReady || !wx.cloud || !wx.cloud.uploadFile) {
      return '';
    }
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const res = await wx.cloud.uploadFile({
      cloudPath: `avatars/${suffix}.png`,
      filePath: tempUrl
    });
    return (res && res.fileID) || '';
  } catch (e) {
    return '';
  }
}

module.exports = { uploadAvatar };
