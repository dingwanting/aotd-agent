const { CLOUD_ENV_ID, USE_CLOUD_CONTAINER } = require("./utils/config");

App({
  onLaunch() {
    if (!USE_CLOUD_CONTAINER) {
      return;
    }

    if (!wx.cloud) {
      console.error("当前基础库不支持 wx.cloud，请升级微信客户端或基础库版本。");
      return;
    }

    wx.cloud.init({
      env: CLOUD_ENV_ID,
      traceUser: true,
    });
  },

  globalData: {},
});
