const { STORAGE_KEYS, clearAnswers, clearQuestionDeck, clearResult, getStorage, setStorage } = require("../../utils/storage");
const { updateUserProfile, trackUserEvent } = require("../../utils/api");

const DEFAULT_AVATAR =
  "https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0";

Page({
  data: {
    showProfileSheet: false,
    nicknameDraft: "",
    avatarUrl: DEFAULT_AVATAR,
    canSubmitProfile: false,
  },

  onShow() {
    const nickname = getStorage(STORAGE_KEYS.nickname, "");
    const avatarUrl = getStorage(STORAGE_KEYS.avatarUrl, DEFAULT_AVATAR);
    this.setData({
      nicknameDraft: nickname && nickname !== "朋友" ? nickname : "",
      avatarUrl: avatarUrl || DEFAULT_AVATAR,
      canSubmitProfile: Boolean((nickname && nickname !== "朋友") && avatarUrl && avatarUrl !== DEFAULT_AVATAR),
    });
  },

  noop() {},

  handleStart() {
    const nickname = getStorage(STORAGE_KEYS.nickname, "");
    const avatarUrl = getStorage(STORAGE_KEYS.avatarUrl, DEFAULT_AVATAR);
    this.setData({
      showProfileSheet: true,
      nicknameDraft: nickname && nickname !== "朋友" ? nickname : "",
      avatarUrl: avatarUrl || DEFAULT_AVATAR,
      canSubmitProfile: Boolean((nickname && nickname !== "朋友") && avatarUrl && avatarUrl !== DEFAULT_AVATAR),
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
      canSubmitProfile: Boolean((this.data.nicknameDraft || "").trim() && avatarUrl && avatarUrl !== DEFAULT_AVATAR),
    });
  },

  handleNicknameBlur(event) {
    const nickname = event && event.detail && event.detail.value ? String(event.detail.value).trim() : "";
    this.setData({
      nicknameDraft: nickname,
      canSubmitProfile: Boolean(nickname && this.data.avatarUrl && this.data.avatarUrl !== DEFAULT_AVATAR),
    });
  },

  async handleProfileSubmit(event) {
    const nickname = event && event.detail && event.detail.value ? String(event.detail.value.nickname || "").trim() : "";
    const avatarUrl = this.data.avatarUrl;
    if (!nickname || !avatarUrl || avatarUrl === DEFAULT_AVATAR) {
      wx.showToast({
        title: "请先填写昵称和头像",
        icon: "none",
      });
      return;
    }

    clearAnswers();
    clearQuestionDeck();
    clearResult();
    setStorage(STORAGE_KEYS.nickname, nickname);
    setStorage(STORAGE_KEYS.avatarUrl, avatarUrl);

    try {
      await updateUserProfile(nickname);
    } catch (error) {
      console.warn("[aotd] update profile failed:", error && error.message ? error.message : error);
    }

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
