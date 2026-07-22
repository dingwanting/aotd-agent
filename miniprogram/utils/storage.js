const STORAGE_KEYS = {
  answers: "aotd.answers",
  result: "aotd.result",
  questionDeck: "aotd.questionDeck",
  questionDeckHistory: "aotd.questionDeckHistory",
  playlistHistory: "aotd.playlistHistory",
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

module.exports = {
  STORAGE_KEYS,
  getStorage,
  setStorage,
  clearResult,
  clearAnswers,
  clearQuestionDeck,
};
