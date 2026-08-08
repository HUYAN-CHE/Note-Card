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

// 底部安全区（px）：统一口径——getWindowInfo 优先（getSystemInfoSync 已废弃）；
// safeAreaInsets 是 iOS 专属字段，安卓没有；安卓微信 safeArea 通常不含系统导航栏（inset=0），
// 所以 inset 为 0 时统一给 12px 最小预留，避免安卓上底部元素贴边。
function getSafeAreaBottom() {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    let inset = 0;
    if (info.safeAreaInsets && typeof info.safeAreaInsets.bottom === 'number') {
      inset = info.safeAreaInsets.bottom;
    } else if (info.safeArea) {
      inset = Math.max(0, info.screenHeight - info.safeArea.bottom);
    }
    return Math.max(inset, 12);
  } catch (e) {
    return 12;
  }
}

module.exports = {
  getNavInfo,
  getSafeAreaBottom
};
