const { STORAGE_KEYS, clearAnswers, clearQuestionDeck, clearResult, getStorage, setStorage } = require("../../utils/storage");
const { updateUserProfile, trackUserEvent } = require("../../utils/api");

const DEFAULT_AVATAR =
  "https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0";

function isDefaultAvatar(avatarUrl) {
  return !avatarUrl || avatarUrl === DEFAULT_AVATAR;
}

function canSubmitProfile(nickname, avatarUrl, avatarFileId) {
  return Boolean(String(nickname || "").trim() && (avatarFileId || !isDefaultAvatar(avatarUrl)));
}

function buildAvatarState() {
  const nickname = getStorage(STORAGE_KEYS.nickname, "");
  const avatarFileId = getStorage(STORAGE_KEYS.avatarFileId, "");
  const avatarUrl = getStorage(STORAGE_KEYS.avatarUrl, "") || avatarFileId || DEFAULT_AVATAR;
  const nicknameDraft = nickname && nickname !== "朋友" ? nickname : "";
  return {
    nicknameDraft,
    avatarFileId: avatarFileId || "",
    avatarUrl,
    canSubmitProfile: canSubmitProfile(nicknameDraft, avatarUrl, avatarFileId),
  };
}

function getFileExtension(filePath) {
  const matched = String(filePath || "").match(/\.([a-zA-Z0-9]+)(?:$|\?)/);
  return matched ? matched[1].toLowerCase() : "png";
}

Page({
  data: {
    showProfileSheet: false,
    nicknameDraft: "",
    avatarUrl: DEFAULT_AVATAR,
    avatarFileId: "",
    canSubmitProfile: false,
  },

  onShow() {
    this.setData(buildAvatarState());
  },

  noop() {},

  handleStart() {
    this.setData({
      showProfileSheet: true,
      ...buildAvatarState(),
    });
  },

  handleCloseProfileSheet() {
    this.setData({
      showProfileSheet: false,
    });
  },

  handleChooseAvatar(event) {
    const avatarUrl = event && event.detail ? event.detail.avatarUrl : "";
    this.setData({
      avatarUrl: avatarUrl || DEFAULT_AVATAR,
      avatarFileId: "",
      canSubmitProfile: canSubmitProfile(this.data.nicknameDraft, avatarUrl, ""),
    });
  },

  handleNicknameInput(event) {
    const nickname = event && event.detail && event.detail.value ? String(event.detail.value).trim() : "";
    this.setData({
      nicknameDraft: nickname,
      canSubmitProfile: canSubmitProfile(nickname, this.data.avatarUrl, this.data.avatarFileId),
    });
  },

  handleNicknameBlur(event) {
    const nickname = event && event.detail && event.detail.value ? String(event.detail.value).trim() : "";
    this.setData({
      nicknameDraft: nickname,
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

  async handleProfileSubmit(event) {
    const formNickname = event && event.detail && event.detail.value ? String(event.detail.value.nickname || "").trim() : "";
    const nickname = formNickname || String(this.data.nicknameDraft || "").trim();
    const avatarUrl = this.data.avatarUrl;
    if (!canSubmitProfile(nickname, avatarUrl, this.data.avatarFileId)) {
      wx.showToast({
        title: "请先填写昵称和头像",
        icon: "none",
      });
      return;
    }

    clearAnswers();
    clearQuestionDeck();
    clearResult();

    try {
      wx.showLoading({
        title: "正在保存头像",
        mask: true,
      });
      const avatarFileId = this.data.avatarFileId || (await this.persistAvatar(avatarUrl));
      setStorage(STORAGE_KEYS.nickname, nickname);
      setStorage(STORAGE_KEYS.avatarFileId, avatarFileId);
      setStorage(STORAGE_KEYS.avatarUrl, avatarFileId);
      await updateUserProfile({
        nickname,
        avatarFileId,
      });
      this.setData({
        avatarFileId,
        avatarUrl: avatarFileId,
      });
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
      showProfileSheet: false,
      nicknameDraft: nickname,
      canSubmitProfile: true,
    });

    wx.redirectTo({
      url: "/pages/question/index?step=consumptionSource"
    });
  },
});
