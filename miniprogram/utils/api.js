const {
  API_BASE_URL,
  CLOUD_ENV_ID,
  CLOUD_SERVICE_NAME,
  CLOUD_SERVICE_FALLBACKS,
  USE_CLOUD_CONTAINER,
  USE_LOCAL_API,
} = require("./config");
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
    const data = {
      ...answers,
      excludeSongIds,
      excludeSongKeys
    };

    const handleSuccess = (response) => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        setStorage(STORAGE_KEYS.result, response.data);
        resolve(response.data);
        return;
      }

      const message = response.data && response.data.error ? response.data.error : "生成歌单失败";
      reject(new Error(message));
    };

    const handleFail = () => {
      reject(new Error("当前无法连接推荐服务，请检查云托管配置或网络。"));
    };

    if (!USE_LOCAL_API && USE_CLOUD_CONTAINER) {
      if (!wx.cloud || !wx.cloud.callContainer) {
        reject(new Error("当前微信基础库不支持云托管调用，请升级微信版本后重试。"));
        return;
      }

      const serviceNames = Array.from(
        new Set([CLOUD_SERVICE_NAME].concat(CLOUD_SERVICE_FALLBACKS || []).filter(Boolean))
      );

      const tryCallContainer = (index) => {
        const serviceName = serviceNames[index];
        if (!serviceName) {
          reject(new Error("当前无法连接推荐服务，请检查云托管环境 ID、服务名或小程序与云环境的关联状态。"));
          return;
        }

        wx.cloud.callContainer({
          config: {
            env: CLOUD_ENV_ID
          },
          path: "/api/aotd/recommendation",
          method: "POST",
          header: {
            "content-type": "application/json",
            "X-WX-SERVICE": serviceName
          },
          data,
          success: handleSuccess,
          fail: (error) => {
            if (index < serviceNames.length - 1) {
              tryCallContainer(index + 1);
              return;
            }

            const detail = error && error.errMsg ? `：${error.errMsg}` : "";
            reject(new Error(`当前无法连接推荐服务，请检查云托管环境 ID、服务名或小程序与云环境的关联状态${detail}`));
          },
        });
      };

      tryCallContainer(0);
      return;
    }

    wx.request({
      url: `${API_BASE_URL}/api/aotd/recommendation`,
      method: "POST",
      header: {
        "content-type": "application/json"
      },
      data,
      success: handleSuccess,
      fail: handleFail,
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
