Page({
  handleBackToResult() {
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
      });
      return;
    }
    wx.redirectTo({
      url: "/pages/result/index",
    });
  },
});
