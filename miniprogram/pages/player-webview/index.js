Page({
  data: {
    src: "",
    title: "网易云播放页",
  },

  onLoad(query) {
    const src = query && query.src ? decodeURIComponent(query.src) : "";
    const title = query && query.title ? decodeURIComponent(query.title) : "网易云播放页";
    if (!src) {
      wx.showToast({
        title: "播放页地址缺失",
        icon: "none",
      });
      wx.navigateBack({
        delta: 1,
      });
      return;
    }

    wx.setNavigationBarTitle({
      title,
    });
    this.setData({
      src,
      title,
    });
  },
});
