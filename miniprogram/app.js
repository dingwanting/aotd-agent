const { CLOUD_ENV_ID, USE_CLOUD_CONTAINER } = require("./utils/config");
const { STORAGE_KEYS, getStorage, setStorage, clearUser } = require("./utils/storage");
const { requestWxLogin } = require("./utils/api");

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

    // 阶段 1：自动登录拿 userId。失败不阻塞主流程（用户也能照常用，只是记忆功能不可用）
    this.bootstrapUser();
  },

  bootstrapUser() {
    const cachedUserId = getStorage(STORAGE_KEYS.userId, "");
    const cachedIsAnon = getStorage(STORAGE_KEYS.isAnonymous, true);
    if (cachedUserId && !cachedIsAnon) {
      // 已经拿到真实 openid（userId 形如 wx-xxx），直接复用
      this.refreshProfile();
      return;
    }

    // 缓存是 anonymous（或没有缓存）—— 清掉重来，确保 secret 配好之后能升级为 wx-xxx
    if (cachedUserId) {
      clearUser();
    }

    if (typeof wx.login !== "function") {
      return;
    }

    wx.login({
      success: (loginRes) => {
        const code = loginRes && loginRes.code;
        if (!code) {
          console.warn("[aotd] wx.login returned empty code");
          return;
        }
        requestWxLogin(code, "")
          .then((payload) => {
            const profile = payload && payload.profile ? payload.profile : null;
            if (!profile) {
              console.warn("[aotd] wx-login response without profile");
              return;
            }
            setStorage(STORAGE_KEYS.userId, profile.userId || "");
            setStorage(STORAGE_KEYS.nickname, profile.nickname || "朋友");
            setStorage(STORAGE_KEYS.isAnonymous, Boolean(profile.isAnonymous));
            console.log(`[aotd] login userId=${profile.userId} anon=${profile.isAnonymous} fallback=${payload.fallback || ""}`);
          })
          .catch((error) => {
            console.warn("[aotd] wx-login failed:", error && error.message ? error.message : error);
          });
      },
      fail: (error) => {
        console.warn("[aotd] wx.login failed:", error && error.errMsg ? error.errMsg : error);
      }
    });
  },

  refreshProfile() {
    // 阶段 1 占位：未来可拉一次 /api/auth/profile 拿最新 nickname
  },

  globalData: {},
});
