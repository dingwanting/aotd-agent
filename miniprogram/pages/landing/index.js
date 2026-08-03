const { STORAGE_KEYS, clearAnswers, clearQuestionDeck, clearResult, getStorage, setStorage } = require("../../utils/storage");
const { updateUserProfile, trackUserEvent } = require("../../utils/api");

const DEFAULT_AVATAR =
  "https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0";
const DEFAULT_SHARE_IMAGE = "/assets/landing/hero-entry-final.jpg";
const DEFAULT_NICKNAME = "朋友";

function isDefaultAvatar(avatarUrl) {
  return !avatarUrl || avatarUrl === DEFAULT_AVATAR;
}

function hasAuthenticNickname(nickname) {
  const normalized = String(nickname || "").trim();
  return Boolean(normalized && normalized !== DEFAULT_NICKNAME);
}

function hasAuthenticAvatar(avatarUrl, avatarFileId) {
  return Boolean(avatarFileId || !isDefaultAvatar(avatarUrl));
}

function hasProfileBasics(nickname, avatarUrl, avatarFileId) {
  return hasAuthenticNickname(nickname) && hasAuthenticAvatar(avatarUrl, avatarFileId);
}

function hasReusableProfileSession(nickname, avatarUrl, avatarFileId) {
  const userId = getStorage(STORAGE_KEYS.userId, "");
  const isAnonymous = getStorage(STORAGE_KEYS.isAnonymous, true);
  return Boolean(userId && !isAnonymous && hasProfileBasics(nickname, avatarUrl, avatarFileId));
}

function canSubmitProfile(nickname, avatarUrl, avatarFileId) {
  return Boolean(String(nickname || "").trim());
}

function shouldShowAuthenticProfileTip(nickname, avatarUrl, avatarFileId) {
  const normalizedNickname = String(nickname || "").trim();
  return Boolean(
    (normalizedNickname && normalizedNickname !== DEFAULT_NICKNAME) ||
      avatarFileId ||
      !isDefaultAvatar(avatarUrl),
  );
}

function buildAvatarState() {
  const nickname = getStorage(STORAGE_KEYS.nickname, "");
  const avatarFileId = getStorage(STORAGE_KEYS.avatarFileId, "");
  const avatarUrl = getStorage(STORAGE_KEYS.avatarUrl, "") || avatarFileId || DEFAULT_AVATAR;
  const nicknameDraft = String(nickname || "").trim() || DEFAULT_NICKNAME;
  return {
    nicknameDraft,
    avatarFileId: avatarFileId || "",
    avatarUrl,
    hasPickedAvatar: Boolean(avatarFileId || !isDefaultAvatar(avatarUrl)),
    showAuthenticProfileTip: shouldShowAuthenticProfileTip(nicknameDraft, avatarUrl, avatarFileId),
    canSubmitProfile: canSubmitProfile(nicknameDraft, avatarUrl, avatarFileId),
  };
}

function getFileExtension(filePath) {
  const matched = String(filePath || "").match(/\.([a-zA-Z0-9]+)(?:$|\?)/);
  return matched ? matched[1].toLowerCase() : "png";
}

function extractChosenImagePath(result) {
  if (!result) {
    return "";
  }
  const mediaFile = Array.isArray(result.tempFiles) && result.tempFiles[0] ? result.tempFiles[0] : null;
  if (mediaFile && mediaFile.tempFilePath) {
    return mediaFile.tempFilePath;
  }
  const filePath = Array.isArray(result.tempFilePaths) && result.tempFilePaths[0] ? result.tempFilePaths[0] : "";
  return filePath || "";
}

Page({
  data: {
    showProfileSheet: false,
    nicknameDraft: "",
    avatarUrl: DEFAULT_AVATAR,
    avatarFileId: "",
    hasPickedAvatar: false,
    showAuthenticProfileTip: false,
    canSubmitProfile: false,
    supportsChooseAvatar: false,
  },

  onLoad() {
    this.setData({
      supportsChooseAvatar: typeof wx.canIUse === "function" && wx.canIUse("button.open-type.chooseAvatar"),
    });
  },

  async onShow() {
    await this.syncLandingProfileState();
  },

  async syncLandingProfileState() {
    const app = getApp ? getApp() : null;
    const userId = getStorage(STORAGE_KEYS.userId, "");
    const isAnonymous = getStorage(STORAGE_KEYS.isAnonymous, true);
    if (userId && !isAnonymous && app && typeof app.refreshProfile === "function") {
      await app.refreshProfile().catch(() => {});
    }
    const avatarState = buildAvatarState();
    this.setData(Object.assign({}, avatarState, {
      showProfileSheet: hasReusableProfileSession(
        avatarState.nicknameDraft,
        avatarState.avatarUrl,
        avatarState.avatarFileId,
      )
        ? false
        : this.data.showProfileSheet,
    }));
  },

  onShareAppMessage() {
    trackUserEvent({
      type: "share_app_message",
      page: "landing",
    }).catch(() => {});
    return {
      title: "来测测你今晚的 AOTD，让歌单和小歌替你说出心情",
      path: "/pages/landing/index",
      imageUrl: DEFAULT_SHARE_IMAGE,
    };
  },

  onShareTimeline() {
    trackUserEvent({
      type: "share_timeline",
      page: "landing",
    }).catch(() => {});
    return {
      title: "来测测你今晚的 AOTD，让歌单和小歌替你说出心情",
      query: "",
      imageUrl: DEFAULT_SHARE_IMAGE,
    };
  },

  noop() {},

  beginQuestionFlow(avatarState) {
    const app = getApp ? getApp() : null;
    if (app && typeof app.ensureUserSession === "function" && !getStorage(STORAGE_KEYS.userId, "")) {
      app.ensureUserSession().catch(() => {});
    }
    clearAnswers();
    clearQuestionDeck();
    clearResult();
    trackUserEvent({
      type: "profile_reuse_before_question",
      nickname: avatarState.nicknameDraft,
      hasAvatar: Boolean(avatarState.avatarFileId || !isDefaultAvatar(avatarState.avatarUrl)),
    }).catch(() => {});
    wx.redirectTo({
      url: "/pages/question/index?step=consumptionSource"
    });
  },

  async handleStart() {
    let avatarState = buildAvatarState();
    if (hasReusableProfileSession(avatarState.nicknameDraft, avatarState.avatarUrl, avatarState.avatarFileId)) {
      this.beginQuestionFlow(avatarState);
      return;
    }

    const app = getApp ? getApp() : null;
    const userId = getStorage(STORAGE_KEYS.userId, "");
    const isAnonymous = getStorage(STORAGE_KEYS.isAnonymous, true);
    if (userId && !isAnonymous && app && typeof app.refreshProfile === "function") {
      wx.showLoading({
        title: "正在读取资料",
        mask: true,
      });
      try {
        await app.refreshProfile().catch(() => {});
      } finally {
        wx.hideLoading();
      }
      avatarState = buildAvatarState();
      if (hasReusableProfileSession(avatarState.nicknameDraft, avatarState.avatarUrl, avatarState.avatarFileId)) {
        this.setData({
          showProfileSheet: false,
          ...avatarState,
        });
        this.beginQuestionFlow(avatarState);
        return;
      }
    }

    this.setData({
      showProfileSheet: true,
      ...avatarState,
    });
  },

  handleCloseProfileSheet() {
    this.setData({
      showProfileSheet: false,
    });
  },

  applyPickedAvatar(avatarUrl) {
    this.setData({
      avatarUrl: avatarUrl || DEFAULT_AVATAR,
      avatarFileId: "",
      hasPickedAvatar: !isDefaultAvatar(avatarUrl),
      showAuthenticProfileTip: shouldShowAuthenticProfileTip(this.data.nicknameDraft, avatarUrl, ""),
      canSubmitProfile: canSubmitProfile(this.data.nicknameDraft, avatarUrl, ""),
    });
  },

  handleChooseAvatar(event) {
    const avatarUrl = event && event.detail ? event.detail.avatarUrl : "";
    if (!avatarUrl || avatarUrl === DEFAULT_AVATAR) {
      return;
    }
    this.applyPickedAvatar(avatarUrl);
  },

  handleAvatarCardTap() {
    if (this.data.supportsChooseAvatar) {
      return;
    }
    this.handlePickAvatar();
  },

  chooseAvatarFromAlbum() {
    return new Promise((resolve, reject) => {
      wx.chooseImage({
        count: 1,
        sizeType: ["compressed"],
        sourceType: ["album"],
        success: resolve,
        fail: reject,
      });
    }).then(extractChosenImagePath);
  },

  async handlePickAvatar() {
    try {
      const avatarUrl = await this.chooseAvatarFromAlbum();
      if (!avatarUrl) {
        return;
      }
      this.applyPickedAvatar(avatarUrl);
    } catch (error) {
      const message = error && error.errMsg ? String(error.errMsg) : "";
      if (message.indexOf("cancel") >= 0) {
        return;
      }
      wx.showModal({
        title: "暂时没选到头像",
        content: "你可以稍后再试，或者先用默认头像继续。",
        showCancel: false,
        confirmText: "我知道了",
      });
    }
  },

  handleNicknameInput(event) {
    const nickname = event && event.detail && event.detail.value ? String(event.detail.value).trim() : "";
    this.setData({
      nicknameDraft: nickname,
      showAuthenticProfileTip: shouldShowAuthenticProfileTip(nickname, this.data.avatarUrl, this.data.avatarFileId),
      canSubmitProfile: canSubmitProfile(nickname, this.data.avatarUrl, this.data.avatarFileId),
    });
  },

  handleNicknameBlur(event) {
    const nickname = event && event.detail && event.detail.value ? String(event.detail.value).trim() : "";
    this.setData({
      nicknameDraft: nickname,
      showAuthenticProfileTip: shouldShowAuthenticProfileTip(nickname, this.data.avatarUrl, this.data.avatarFileId),
      canSubmitProfile: canSubmitProfile(nickname, this.data.avatarUrl, this.data.avatarFileId),
    });
  },

  async ensureLocalAvatarPath(avatarUrl) {
    if (!avatarUrl || avatarUrl.indexOf("wxfile://") === 0 || avatarUrl.indexOf(wx.env.USER_DATA_PATH) === 0) {
      return avatarUrl;
    }
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: avatarUrl,
        success: (res) => {
          if (res && res.tempFilePath) {
            resolve(res.tempFilePath);
            return;
          }
          reject(new Error("头像下载失败"));
        },
        fail: () => reject(new Error("头像下载失败")),
      });
    });
  },

  async cacheAvatarForReuse(avatarUrl) {
    if (!avatarUrl || isDefaultAvatar(avatarUrl)) {
      return avatarUrl || DEFAULT_AVATAR;
    }
    if (avatarUrl.indexOf("cloud://") === 0 || avatarUrl.indexOf(wx.env.USER_DATA_PATH) === 0) {
      return avatarUrl;
    }
    const localPath = await this.ensureLocalAvatarPath(avatarUrl);
    if (!localPath || typeof wx.getFileSystemManager !== "function") {
      return localPath || avatarUrl;
    }
    const extension = getFileExtension(localPath);
    const targetPath = `${wx.env.USER_DATA_PATH}/aotd-avatar-current.${extension}`;
    const fs = wx.getFileSystemManager();
    await new Promise((resolve) => {
      fs.unlink({
        filePath: targetPath,
        complete: () => resolve(),
      });
    });
    await new Promise((resolve, reject) => {
      fs.copyFile({
        srcPath: localPath,
        destPath: targetPath,
        success: () => resolve(),
        fail: reject,
      });
    });
    return targetPath;
  },

  async persistAvatar(avatarUrl) {
    if (!avatarUrl || isDefaultAvatar(avatarUrl)) {
      throw new Error("请先选择头像");
    }
    if (avatarUrl.indexOf("cloud://") === 0) {
      return avatarUrl;
    }
    if (!wx.cloud || typeof wx.cloud.uploadFile !== "function") {
      throw new Error("当前环境不支持头像上传");
    }

    const localPath = await this.ensureLocalAvatarPath(avatarUrl);
    const userId = getStorage(STORAGE_KEYS.userId, "guest");
    const extension = getFileExtension(localPath);
    const cloudPath = `aotd/avatar/${userId}/${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
    const uploaded = await wx.cloud.uploadFile({
      cloudPath,
      filePath: localPath,
    });
    return uploaded.fileID;
  },

  persistProfileLocally(nickname, avatarUrl, avatarFileId) {
    setStorage(STORAGE_KEYS.nickname, nickname);
    setStorage(STORAGE_KEYS.avatarUrl, avatarUrl || DEFAULT_AVATAR);
    setStorage(STORAGE_KEYS.avatarFileId, avatarFileId || "");
    setStorage(STORAGE_KEYS.pendingProfileSync, {
      nickname,
      avatarFileId: avatarFileId || "",
    });
    this.setData({
      nicknameDraft: nickname,
      avatarUrl: avatarUrl || DEFAULT_AVATAR,
      avatarFileId: avatarFileId || "",
      hasPickedAvatar: Boolean(avatarFileId || !isDefaultAvatar(avatarUrl)),
      showAuthenticProfileTip: shouldShowAuthenticProfileTip(nickname, avatarUrl, avatarFileId),
      canSubmitProfile: true,
      showProfileSheet: false,
    });
  },

  syncProfileInBackground(nickname, avatarUrl) {
    const app = getApp ? getApp() : null;
    Promise.resolve()
      .then(async () => {
        const userId = app && typeof app.ensureUserSession === "function"
          ? await app.ensureUserSession()
          : getStorage(STORAGE_KEYS.userId, "");
        let avatarFileId = getStorage(STORAGE_KEYS.avatarFileId, "");
        if (!avatarFileId && avatarUrl && !isDefaultAvatar(avatarUrl)) {
          try {
            avatarFileId = await this.persistAvatar(avatarUrl);
            setStorage(STORAGE_KEYS.avatarFileId, avatarFileId);
            setStorage(STORAGE_KEYS.avatarUrl, avatarFileId);
            if (this.setData) {
              this.setData({
                avatarFileId,
                avatarUrl: avatarFileId,
                hasPickedAvatar: true,
                showAuthenticProfileTip: shouldShowAuthenticProfileTip(this.data.nicknameDraft, avatarFileId, avatarFileId),
              });
            }
          } catch (error) {
            console.warn("[aotd] avatar upload deferred:", error && error.message ? error.message : error);
          }
        }
        if (!userId) {
          setStorage(STORAGE_KEYS.pendingProfileSync, {
            nickname,
            avatarFileId: avatarFileId || "",
          });
          return;
        }
        await updateUserProfile({
          nickname,
          avatarFileId: avatarFileId || "",
        });
        wx.removeStorageSync(STORAGE_KEYS.pendingProfileSync);
      })
      .catch((error) => {
        console.warn("[aotd] profile sync deferred:", error && error.message ? error.message : error);
      });
  },

  async handleProfileSubmit(event) {
    const formNickname = event && event.detail && event.detail.value ? String(event.detail.value.nickname || "").trim() : "";
    const nickname = formNickname || String(this.data.nicknameDraft || "").trim();
    const avatarUrl = this.data.avatarUrl;
    if (!canSubmitProfile(nickname, avatarUrl, this.data.avatarFileId)) {
      wx.showToast({
        title: "请先填写昵称",
        icon: "none",
      });
      return;
    }

    clearAnswers();
    clearQuestionDeck();
    clearResult();

    try {
      wx.showLoading({
        title: "正在保存资料",
        mask: true,
      });
      const stableAvatarUrl = await this.cacheAvatarForReuse(avatarUrl).catch(() => avatarUrl);
      const avatarFileId = this.data.avatarFileId || "";
      this.persistProfileLocally(nickname, stableAvatarUrl, avatarFileId);
      this.syncProfileInBackground(nickname, stableAvatarUrl);
    } catch (error) {
      console.warn("[aotd] update profile failed:", error && error.message ? error.message : error);
      wx.hideLoading();
      wx.showToast({
        title: error && error.message ? error.message : "头像保存失败",
        icon: "none",
      });
      return;
    }
    wx.hideLoading();

    trackUserEvent({
      type: "profile_authorized_before_question",
      nickname,
      hasAvatar: true,
    }).catch(() => {});

    this.setData({
      nicknameDraft: nickname,
      hasPickedAvatar: Boolean(this.data.avatarFileId || !isDefaultAvatar(this.data.avatarUrl)),
      showAuthenticProfileTip: shouldShowAuthenticProfileTip(nickname, this.data.avatarUrl, this.data.avatarFileId),
      canSubmitProfile: true,
    });

    wx.redirectTo({
      url: "/pages/question/index?step=consumptionSource"
    });
  },
});
