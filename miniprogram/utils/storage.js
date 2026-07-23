const STORAGE_KEYS = {
  answers: "aotd.answers",
  result: "aotd.result",
  questionDeck: "aotd.questionDeck",
  questionDeckHistory: "aotd.questionDeckHistory",
  playlistHistory: "aotd.playlistHistory",
  userId: "aotd.userId",
  nickname: "aotd.nickname",
  avatarFileId: "aotd.avatarFileId",
  avatarUrl: "aotd.avatarUrl",
  pendingProfileSync: "aotd.pendingProfileSync",
  isAnonymous: "aotd.isAnonymous",
};

function getStorage(key, fallbackValue) {
  try {
    const value = wx.getStorageSync(key);
    return value || fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function setStorage(key, value) {
  wx.setStorageSync(key, value);
}

function clearResult() {
  try {
    wx.removeStorageSync(STORAGE_KEYS.result);
  } catch {
    // ignore
  }
}

function clearAnswers() {
  try {
    wx.removeStorageSync(STORAGE_KEYS.answers);
  } catch {
    // ignore
  }
}

function clearQuestionDeck() {
  try {
    wx.removeStorageSync(STORAGE_KEYS.questionDeck);
  } catch {
    // ignore
  }
}

// 仅清登录态，让已保存的昵称和头像可以跨次进入复用。
function clearSessionIdentity() {
  try {
    wx.removeStorageSync(STORAGE_KEYS.userId);
  } catch {
    // ignore
  }
  try {
    wx.removeStorageSync(STORAGE_KEYS.isAnonymous);
  } catch {
    // ignore
  }
}

// 全量清用户资料，保留给明确需要重置用户信息的场景。
function clearUser() {
  try {
    wx.removeStorageSync(STORAGE_KEYS.userId);
  } catch {
    // ignore
  }
  try {
    wx.removeStorageSync(STORAGE_KEYS.nickname);
  } catch {
    // ignore
  }
  try {
    wx.removeStorageSync(STORAGE_KEYS.avatarFileId);
  } catch {
    // ignore
  }
  try {
    wx.removeStorageSync(STORAGE_KEYS.avatarUrl);
  } catch {
    // ignore
  }
  try {
    wx.removeStorageSync(STORAGE_KEYS.pendingProfileSync);
  } catch {
    // ignore
  }
  try {
    wx.removeStorageSync(STORAGE_KEYS.isAnonymous);
  } catch {
    // ignore
  }
}

module.exports = {
  STORAGE_KEYS,
  getStorage,
  setStorage,
  clearResult,
  clearAnswers,
  clearQuestionDeck,
  clearSessionIdentity,
  clearUser,
};
