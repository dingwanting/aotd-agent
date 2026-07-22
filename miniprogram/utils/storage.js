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

// 阶段 1：清用户态只清 userId/nickname，不动答题缓存（避免答题中途被踢掉）
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
  clearUser,
};
