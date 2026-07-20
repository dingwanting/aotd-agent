const { API_BASE_URL } = require("./config");
const { STORAGE_KEYS, getStorage, setStorage } = require("./storage");

function isSameAnswers(left, right) {
  return (
    left &&
    right &&
    left.consumptionSource === right.consumptionSource &&
    left.emotionalNeed === right.emotionalNeed &&
    left.emotionalImagery === right.emotionalImagery
  );
}

function requestRecommendation(answers) {
  const previousResult = getStorage(STORAGE_KEYS.result, null);
  const excludeSongIds =
    previousResult && previousResult.playlist && previousResult.playlist.tracks
      ? previousResult.playlist.tracks.map((track) => track.song && track.song.id).filter(Boolean)
      : [];
  const excludeSongKeys =
    previousResult && previousResult.playlist && previousResult.playlist.tracks
      ? previousResult.playlist.tracks
          .map((track) => {
            const song = track.song || {};
            return song.title && song.artist ? `${song.title}::${song.artist}` : "";
          })
          .filter(Boolean)
      : [];

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${API_BASE_URL}/api/aotd/recommendation`,
      method: "POST",
      header: {
        "content-type": "application/json"
      },
      data: {
        ...answers,
        excludeSongIds,
        excludeSongKeys
      },
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          setStorage(STORAGE_KEYS.result, response.data);
          resolve(response.data);
          return;
        }

        const message = response.data && response.data.error ? response.data.error : "生成歌单失败";
        reject(new Error(message));
      },
      fail: () => {
        reject(new Error("当前无法连接推荐服务，请检查 API 地址或网络。"));
      }
    });
  });
}

function loadResultIfMatched(answers) {
  const cached = getStorage(STORAGE_KEYS.result, null);
  if (cached && isSameAnswers(cached.answers, answers)) {
    return cached;
  }
  return null;
}

module.exports = {
  requestRecommendation,
  loadResultIfMatched
};
