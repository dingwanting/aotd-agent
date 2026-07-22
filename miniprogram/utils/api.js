const {
  API_BASE_URL,
  CLOUD_ENV_ID,
  CLOUD_SERVICE_NAME,
  CLOUD_SERVICE_FALLBACKS,
  USE_CLOUD_CONTAINER,
  USE_LOCAL_API,
} = require("./config");
const { STORAGE_KEYS, getStorage, setStorage } = require("./storage");

const PLAYLIST_HISTORY_LIMIT = 6;

function buildRotationSeed() {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function isSameAnswers(left, right) {
  return (
    left &&
    right &&
    left.consumptionSource === right.consumptionSource &&
    left.emotionalNeed === right.emotionalNeed &&
    left.emotionalImagery === right.emotionalImagery
  );
}

function normalizePlaylistHistory(rawHistory) {
  return Array.isArray(rawHistory)
    ? rawHistory.filter((item) => item && item.answers && item.playlist && Array.isArray(item.playlist.tracks))
    : [];
}

function buildSongKey(song) {
  return song && song.title && song.artist ? `${song.title}::${song.artist}` : "";
}

function collectRecentExclusions() {
  const history = normalizePlaylistHistory(getStorage(STORAGE_KEYS.playlistHistory, []));
  const excludeSongIds = [];
  const excludeSongKeys = [];

  history.slice(0, PLAYLIST_HISTORY_LIMIT).forEach((item) => {
    item.playlist.tracks.forEach((track) => {
      const song = track && track.song ? track.song : {};
      if (song.id) {
        excludeSongIds.push(song.id);
      }
      const key = buildSongKey(song);
      if (key) {
        excludeSongKeys.push(key);
      }
    });
  });

  return {
    excludeSongIds: Array.from(new Set(excludeSongIds)),
    excludeSongKeys: Array.from(new Set(excludeSongKeys)),
  };
}

function appendPlaylistHistory(result) {
  const history = normalizePlaylistHistory(getStorage(STORAGE_KEYS.playlistHistory, []));
  const nextEntry = {
    answers: result.answers,
    playlist: result.playlist,
  };

  const deduped = [nextEntry]
    .concat(history.filter((item) => !isSameAnswers(item.answers, nextEntry.answers)))
    .slice(0, PLAYLIST_HISTORY_LIMIT);

  setStorage(STORAGE_KEYS.playlistHistory, deduped);
}

function requestRecommendation(answers) {
  const previousResult = getStorage(STORAGE_KEYS.result, null);
  const recentExclusions = collectRecentExclusions();
  const excludeSongIds =
    recentExclusions.excludeSongIds.concat(
      previousResult && previousResult.playlist && previousResult.playlist.tracks
        ? previousResult.playlist.tracks.map((track) => track.song && track.song.id).filter(Boolean)
        : []
    );
  const excludeSongKeys =
    recentExclusions.excludeSongKeys.concat(
      previousResult && previousResult.playlist && previousResult.playlist.tracks
        ? previousResult.playlist.tracks
            .map((track) => buildSongKey(track.song || {}))
            .filter(Boolean)
        : []
    );

  return new Promise((resolve, reject) => {
    const data = {
      ...answers,
      excludeSongIds: Array.from(new Set(excludeSongIds)),
      excludeSongKeys: Array.from(new Set(excludeSongKeys)),
      rotationSeed: buildRotationSeed()
    };

    const userId = getStorage(STORAGE_KEYS.userId, "");
    const requestHeaders = { "content-type": "application/json" };
    if (userId) {
      requestHeaders["X-AOTD-User-Id"] = userId;
    }

    const handleSuccess = (response) => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        setStorage(STORAGE_KEYS.result, response.data);
        appendPlaylistHistory(response.data);
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
          header: Object.assign({ "X-WX-SERVICE": serviceName }, requestHeaders),
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
      header: requestHeaders,
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

function requestWxLogin(code, nickname) {
  const userId = getStorage(STORAGE_KEYS.userId, "");
  const headers = { "content-type": "application/json" };
  if (userId) {
    headers["X-AOTD-User-Id"] = userId;
  }
  return new Promise((resolve, reject) => {
    const data = { code, nickname: nickname || "" };
    if (!USE_LOCAL_API && USE_CLOUD_CONTAINER) {
      if (!wx.cloud || !wx.cloud.callContainer) {
        reject(new Error("当前微信基础库不支持云托管调用"));
        return;
      }
      const serviceNames = Array.from(
        new Set([CLOUD_SERVICE_NAME].concat(CLOUD_SERVICE_FALLBACKS || []).filter(Boolean))
      );
      const tryCall = (index) => {
        const serviceName = serviceNames[index];
        if (!serviceName) {
          reject(new Error("无法连接到云托管服务"));
          return;
        }
        wx.cloud.callContainer({
          config: { env: CLOUD_ENV_ID },
          path: "/api/auth/wx-login",
          method: "POST",
          header: Object.assign({ "X-WX-SERVICE": serviceName }, headers),
          data,
          success: (response) => {
            if (response.statusCode >= 200 && response.statusCode < 300 && response.data && response.data.profile) {
              resolve(response.data);
              return;
            }
            const message = response.data && response.data.error ? response.data.error : "登录失败";
            reject(new Error(message));
          },
          fail: (error) => {
            if (index < serviceNames.length - 1) {
              tryCall(index + 1);
              return;
            }
            const detail = error && error.errMsg ? `：${error.errMsg}` : "";
            reject(new Error(`登录失败${detail}`));
          },
        });
      };
      tryCall(0);
      return;
    }
    wx.request({
      url: `${API_BASE_URL}/api/auth/wx-login`,
      method: "POST",
      header: headers,
      data,
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300 && response.data && response.data.profile) {
          resolve(response.data);
          return;
        }
        const message = response.data && response.data.error ? response.data.error : "登录失败";
        reject(new Error(message));
      },
      fail: (error) => {
        const detail = error && error.errMsg ? `：${error.errMsg}` : "";
        reject(new Error(`登录失败${detail}`));
      },
    });
  });
}

module.exports = {
  requestRecommendation,
  loadResultIfMatched,
  requestWxLogin,
};
