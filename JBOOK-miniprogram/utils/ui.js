function getNavInfo() {
  try {
    const sys = wx.getSystemInfoSync();
    const rect = wx.getMenuButtonBoundingClientRect();

    const statusBarHeight = sys.statusBarHeight || 20;
    const menuButtonHeight = rect.height || 32;
    const menuButtonTop = rect.top || statusBarHeight + 4;

    // 导航栏内容区高度 = 胶囊按钮上间距 + 按钮高度 + 下间距 + 额外留白
    const navHeight = Math.max(
      (menuButtonTop - statusBarHeight) * 2 + menuButtonHeight + 12,
      56
    );

    return {
      statusBarHeight,
      navHeight,
      totalHeight: statusBarHeight + navHeight
    };
  } catch (e) {
    return {
      statusBarHeight: 20,
      navHeight: 44,
      totalHeight: 64
    };
  }
}

module.exports = {
  getNavInfo
};
