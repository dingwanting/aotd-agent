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
const RECOMMENDATION_REQUEST_TIMEOUT_MS = 25000;
const RECOMMENDATION_RETRY_LIMIT = 3;
const RECOMMENDATION_RETRY_DELAY_MS = 700;

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

function syncMemorySnapshot(memory) {
  if (!memory || typeof memory !== "object") {
    return;
  }
  if (memory.questionDeckHistory) {
    setStorage(STORAGE_KEYS.questionDeckHistory, memory.questionDeckHistory);
  }
  if (Array.isArray(memory.playlistHistory)) {
    setStorage(STORAGE_KEYS.playlistHistory, memory.playlistHistory);
  }
}

function persistProfilePayload(payload) {
  if (!payload || !payload.profile) {
    return;
  }
  setStorage(STORAGE_KEYS.userId, payload.profile.userId || "");
  setStorage(STORAGE_KEYS.nickname, payload.profile.nickname || "朋友");
  setStorage(STORAGE_KEYS.avatarFileId, payload.profile.avatarFileId || "");
  setStorage(STORAGE_KEYS.avatarUrl, payload.profile.avatarFileId || "");
  setStorage(STORAGE_KEYS.isAnonymous, Boolean(payload.profile.isAnonymous));
  syncMemorySnapshot(payload.memory);
}

function normalizeProfileInput(profileInput) {
  if (typeof profileInput === "string") {
    return {
      nickname: profileInput,
      avatarFileId: "",
    };
  }
  return {
    nickname: profileInput && typeof profileInput.nickname === "string" ? profileInput.nickname : "",
    avatarFileId: profileInput && typeof profileInput.avatarFileId === "string" ? profileInput.avatarFileId : "",
  };
}

function withTimeout(taskFactory, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    Promise.resolve()
      .then(taskFactory)
      .then((value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
  });
}

function shouldRetryRecommendationError(error) {
  const message = error && error.message ? String(error.message) : "";
  if (!message) {
    return false;
  }
  return /timeout|timed out|network|fetch failed|econnreset|enotfound|eai_again|无法连接|服务异常|服务繁忙|500|502|503|504/i.test(message);
}

function requestRecommendationOnce(answers) {
  const previousResult = getStorage(STORAGE_KEYS.result, null);
  const recentExclusions = collectRecentExclusions();
  const previousTracks =
    previousResult &&
    isSameAnswers(previousResult.answers, answers) &&
    previousResult.playlist &&
    previousResult.playlist.tracks
      ? previousResult.playlist.tracks
      : [];
  const excludeSongIds =
    recentExclusions.excludeSongIds.concat(
      previousTracks.map((track) => track.song && track.song.id).filter(Boolean)
    );
  const excludeSongKeys =
    recentExclusions.excludeSongKeys.concat(
      previousTracks
        .map((track) => buildSongKey(track.song || {}))
        .filter(Boolean)
    );

  return new Promise((resolve, reject) => {
    const data = {
      ...answers,
      questionDeckIds: (() => {
        const deck = getStorage(STORAGE_KEYS.questionDeck, null);
        return deck
          ? {
              consumptionSource: deck.consumptionSource && deck.consumptionSource.deckId,
              emotionalNeed: deck.emotionalNeed && deck.emotionalNeed.deckId,
              emotionalImagery: deck.emotionalImagery && deck.emotionalImagery.deckId,
            }
          : undefined;
      })(),
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
        syncMemorySnapshot(response.data && response.data.memory);
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

        withTimeout(
          () =>
            new Promise((innerResolve, innerReject) => {
              wx.cloud.callContainer({
                config: {
                  env: CLOUD_ENV_ID
                },
                path: "/api/aotd/recommendation",
                method: "POST",
                header: Object.assign({ "X-WX-SERVICE": serviceName }, requestHeaders),
                data,
                success: innerResolve,
                fail: innerReject,
              });
            }),
          RECOMMENDATION_REQUEST_TIMEOUT_MS,
          "推荐服务响应超时，请稍后再试",
        )
          .then(handleSuccess)
          .catch((error) => {
            if (index < serviceNames.length - 1) {
              tryCallContainer(index + 1);
              return;
            }

            const detail = error && error.errMsg ? `：${error.errMsg}` : error && error.message ? `：${error.message}` : "";
            reject(new Error(`当前无法连接推荐服务，请检查云托管环境 ID、服务名或小程序与云环境的关联状态${detail}`));
          });
      };

      tryCallContainer(0);
      return;
    }

    wx.request({
      url: `${API_BASE_URL}/api/aotd/recommendation`,
      method: "POST",
      timeout: RECOMMENDATION_REQUEST_TIMEOUT_MS,
      header: requestHeaders,
      data,
      success: handleSuccess,
      fail: handleFail,
    });
  });
}

async function requestRecommendation(answers) {
  let lastError = null;
  for (let attempt = 1; attempt <= RECOMMENDATION_RETRY_LIMIT; attempt += 1) {
    try {
      return await requestRecommendationOnce(answers);
    } catch (error) {
      lastError = error;
      if (!shouldRetryRecommendationError(error) || attempt >= RECOMMENDATION_RETRY_LIMIT) {
        break;
      }
      await sleep(RECOMMENDATION_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError || new Error("生成歌单失败");
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
              persistProfilePayload(response.data);
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
          persistProfilePayload(response.data);
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

function requestProfile() {
  const userId = getStorage(STORAGE_KEYS.userId, "");
  const headers = {};
  if (userId) {
    headers["X-AOTD-User-Id"] = userId;
  }
  return new Promise((resolve, reject) => {
    const handleSuccess = (response) => {
      if (response.statusCode >= 200 && response.statusCode < 300 && response.data && response.data.profile) {
        persistProfilePayload(response.data);
        resolve(response.data);
        return;
      }
      reject(new Error((response.data && response.data.error) || "获取登录态失败"));
    };

    if (!USE_LOCAL_API && USE_CLOUD_CONTAINER) {
      const serviceNames = Array.from(new Set([CLOUD_SERVICE_NAME].concat(CLOUD_SERVICE_FALLBACKS || []).filter(Boolean)));
      const tryCall = (index) => {
        const serviceName = serviceNames[index];
        if (!serviceName) {
          reject(new Error("无法连接到云托管服务"));
          return;
        }
        wx.cloud.callContainer({
          config: { env: CLOUD_ENV_ID },
          path: "/api/auth/profile",
          method: "GET",
          header: Object.assign({ "X-WX-SERVICE": serviceName }, headers),
          success: handleSuccess,
          fail: (error) => {
            if (index < serviceNames.length - 1) {
              tryCall(index + 1);
              return;
            }
            reject(new Error((error && error.errMsg) || "获取登录态失败"));
          },
        });
      };
      tryCall(0);
      return;
    }

    wx.request({
      url: `${API_BASE_URL}/api/auth/profile`,
      method: "GET",
      header: headers,
      success: handleSuccess,
      fail: (error) => reject(new Error((error && error.errMsg) || "获取登录态失败")),
    });
  });
}

function updateUserProfile(profileInput) {
  return new Promise((resolve, reject) => {
    Promise.resolve()
      .then(() => {
        const existingUserId = getStorage(STORAGE_KEYS.userId, "");
        if (existingUserId) {
          return existingUserId;
        }
        return requestProfile().then((payload) => {
          const profile = payload && payload.profile ? payload.profile : null;
          return profile && profile.userId ? profile.userId : "";
        });
      })
      .then(() => {
        const userId = getStorage(STORAGE_KEYS.userId, "");
        const headers = { "content-type": "application/json" };
        if (userId) {
          headers["X-AOTD-User-Id"] = userId;
        }
        const nextProfile = normalizeProfileInput(profileInput);
        const data = {};
        if (nextProfile.nickname) {
          data.nickname = nextProfile.nickname;
        }
        if (nextProfile.avatarFileId) {
          data.avatarFileId = nextProfile.avatarFileId;
        }
        const handleSuccess = (response) => {
          if (response.statusCode >= 200 && response.statusCode < 300 && response.data && response.data.profile) {
            persistProfilePayload(response.data);
            resolve(response.data);
            return;
          }
          reject(new Error((response.data && response.data.error) || "更新昵称失败"));
        };

        if (!USE_LOCAL_API && USE_CLOUD_CONTAINER) {
          const serviceNames = Array.from(new Set([CLOUD_SERVICE_NAME].concat(CLOUD_SERVICE_FALLBACKS || []).filter(Boolean)));
          const tryCall = (index) => {
            const serviceName = serviceNames[index];
            if (!serviceName) {
              reject(new Error("无法连接到云托管服务"));
              return;
            }
            wx.cloud.callContainer({
              config: { env: CLOUD_ENV_ID },
              path: "/api/auth/profile",
              method: "POST",
              header: Object.assign({ "X-WX-SERVICE": serviceName }, headers),
              data,
              success: handleSuccess,
              fail: (error) => {
                if (index < serviceNames.length - 1) {
                  tryCall(index + 1);
                  return;
                }
                reject(new Error((error && error.errMsg) || "更新昵称失败"));
              },
            });
          };
          tryCall(0);
          return;
        }

        wx.request({
          url: `${API_BASE_URL}/api/auth/profile`,
          method: "POST",
          header: headers,
          data,
          success: handleSuccess,
          fail: (error) => reject(new Error((error && error.errMsg) || "更新昵称失败")),
        });
      })
      .catch(reject);
  });
}

function trackUserEvent(event) {
  const userId = getStorage(STORAGE_KEYS.userId, "");
  if (!userId) {
    return Promise.resolve();
  }
  const headers = { "content-type": "application/json", "X-AOTD-User-Id": userId };
  return new Promise((resolve) => {
    const handleDone = () => resolve();
    if (!USE_LOCAL_API && USE_CLOUD_CONTAINER) {
      const serviceNames = Array.from(new Set([CLOUD_SERVICE_NAME].concat(CLOUD_SERVICE_FALLBACKS || []).filter(Boolean)));
      const tryCall = (index) => {
        const serviceName = serviceNames[index];
        if (!serviceName) {
          resolve();
          return;
        }
        wx.cloud.callContainer({
          config: { env: CLOUD_ENV_ID },
          path: "/api/user/events",
          method: "POST",
          header: Object.assign({ "X-WX-SERVICE": serviceName }, headers),
          data: event,
          success: handleDone,
          fail: () => {
            if (index < serviceNames.length - 1) {
              tryCall(index + 1);
              return;
            }
            resolve();
          },
        });
      };
      tryCall(0);
      return;
    }
    wx.request({
      url: `${API_BASE_URL}/api/user/events`,
      method: "POST",
      header: headers,
      data: event,
      success: handleDone,
      fail: handleDone,
    });
  });
}

function requestEveningReminderStatus() {
  const userId = getStorage(STORAGE_KEYS.userId, "");
  const headers = {};
  if (userId) {
    headers["X-AOTD-User-Id"] = userId;
  }
  return new Promise((resolve, reject) => {
    const handleSuccess = (response) => {
      if (response.statusCode >= 200 && response.statusCode < 300 && response.data && response.data.ok) {
        resolve(response.data);
        return;
      }
      reject(new Error((response.data && response.data.error) || "获取提醒状态失败"));
    };

    if (!USE_LOCAL_API && USE_CLOUD_CONTAINER) {
      const serviceNames = Array.from(new Set([CLOUD_SERVICE_NAME].concat(CLOUD_SERVICE_FALLBACKS || []).filter(Boolean)));
      const tryCall = (index) => {
        const serviceName = serviceNames[index];
        if (!serviceName) {
          reject(new Error("无法连接到云托管服务"));
          return;
        }
        wx.cloud.callContainer({
          config: { env: CLOUD_ENV_ID },
          path: "/api/reminders/evening-status",
          method: "GET",
          header: Object.assign({ "X-WX-SERVICE": serviceName }, headers),
          success: handleSuccess,
          fail: (error) => {
            if (index < serviceNames.length - 1) {
              tryCall(index + 1);
              return;
            }
            reject(new Error((error && error.errMsg) || "获取提醒状态失败"));
          },
        });
      };
      tryCall(0);
      return;
    }

    wx.request({
      url: `${API_BASE_URL}/api/reminders/evening-status`,
      method: "GET",
      header: headers,
      success: handleSuccess,
      fail: (error) => reject(new Error((error && error.errMsg) || "获取提醒状态失败")),
    });
  });
}

function createEveningReminder() {
  const userId = getStorage(STORAGE_KEYS.userId, "");
  const headers = { "content-type": "application/json" };
  if (userId) {
    headers["X-AOTD-User-Id"] = userId;
  }
  return new Promise((resolve, reject) => {
    const handleSuccess = (response) => {
      if (response.statusCode >= 200 && response.statusCode < 300 && response.data && response.data.ok) {
        resolve(response.data);
        return;
      }
      reject(new Error((response.data && response.data.error) || "创建提醒失败"));
    };

    if (!USE_LOCAL_API && USE_CLOUD_CONTAINER) {
      const serviceNames = Array.from(new Set([CLOUD_SERVICE_NAME].concat(CLOUD_SERVICE_FALLBACKS || []).filter(Boolean)));
      const tryCall = (index) => {
        const serviceName = serviceNames[index];
        if (!serviceName) {
          reject(new Error("无法连接到云托管服务"));
          return;
        }
        wx.cloud.callContainer({
          config: { env: CLOUD_ENV_ID },
          path: "/api/reminders/evening-subscribe",
          method: "POST",
          header: Object.assign({ "X-WX-SERVICE": serviceName }, headers),
          data: {},
          success: handleSuccess,
          fail: (error) => {
            if (index < serviceNames.length - 1) {
              tryCall(index + 1);
              return;
            }
            reject(new Error((error && error.errMsg) || "创建提醒失败"));
          },
        });
      };
      tryCall(0);
      return;
    }

    wx.request({
      url: `${API_BASE_URL}/api/reminders/evening-subscribe`,
      method: "POST",
      header: headers,
      data: {},
      success: handleSuccess,
      fail: (error) => reject(new Error((error && error.errMsg) || "创建提醒失败")),
    });
  });
}

function normalizeApiUrl(urlOrPath) {
  if (!urlOrPath) {
    return "";
  }
  if (/^https?:\/\//i.test(urlOrPath)) {
    return urlOrPath;
  }
  return `${API_BASE_URL}${String(urlOrPath).startsWith("/") ? "" : "/"}${urlOrPath}`;
}

function buildAotdSongMediaUrl(urlOrPath) {
  if (!urlOrPath) {
    return "";
  }
  return `${API_BASE_URL}/api/aotd-song/media?source=${encodeURIComponent(String(urlOrPath))}`;
}

function normalizeAotdSongTaskPayload(data) {
  const task = data && data.task ? data.task : {};
  const song = task && task.song ? task.song : {};
  return Object.assign({}, data, {
    task: Object.assign({}, task, {
      song: song
        ? Object.assign({}, song, {
            audioUrl: buildAotdSongMediaUrl(song.audioPath || song.audioUrl || ""),
          })
        : null,
    }),
  });
}

function normalizeAotdSongErrorMessage(errorOrMessage, fallbackMessage) {
  const rawMessage =
    typeof errorOrMessage === "string"
      ? errorOrMessage
      : errorOrMessage && errorOrMessage.message
        ? errorOrMessage.message
        : fallbackMessage || "制作 AOTD 失败";
  const message = String(rawMessage || fallbackMessage || "制作 AOTD 失败");
  if (/fetch failed|network|timeout|timed out|econnreset|enotfound|eai_again/i.test(message)) {
    return "真实音乐服务暂时不稳定，已切换重试链路，请稍后再试";
  }
  return message;
}

function callAotdSongApi(path, method, payload) {
  const userId = getStorage(STORAGE_KEYS.userId, "");
  const headers = { "content-type": "application/json" };
  if (userId) {
    headers["X-AOTD-User-Id"] = userId;
  }
  return new Promise((resolve, reject) => {
    const handleSuccess = (response) => {
      if (response.statusCode >= 200 && response.statusCode < 300 && response.data && response.data.ok) {
        resolve(normalizeAotdSongTaskPayload(response.data || {}));
        return;
      }
      reject(new Error(normalizeAotdSongErrorMessage(response.data && response.data.error, "制作 AOTD 失败")));
    };

    if (!USE_LOCAL_API && USE_CLOUD_CONTAINER) {
      const serviceNames = Array.from(new Set([CLOUD_SERVICE_NAME].concat(CLOUD_SERVICE_FALLBACKS || []).filter(Boolean)));
      const tryCall = (index) => {
        const serviceName = serviceNames[index];
        if (!serviceName) {
          reject(new Error("无法连接到云托管服务"));
          return;
        }
        wx.cloud.callContainer({
          config: { env: CLOUD_ENV_ID },
          path,
          method,
          header: Object.assign({ "X-WX-SERVICE": serviceName }, headers),
          data: payload,
          success: handleSuccess,
          fail: (error) => {
            if (index < serviceNames.length - 1) {
              tryCall(index + 1);
              return;
            }
            reject(new Error(normalizeAotdSongErrorMessage(error && error.errMsg, "制作 AOTD 失败")));
          },
        });
      };
      tryCall(0);
      return;
    }

    wx.request({
      url: `${API_BASE_URL}${path}`,
      method,
      header: headers,
      data: payload,
      success: handleSuccess,
      fail: (error) => reject(new Error(normalizeAotdSongErrorMessage(error && error.errMsg, "制作 AOTD 失败"))),
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const AOTD_TASK_WAIT_TIMEOUT_MS = 8 * 60 * 1000;
const AOTD_TASK_CONTINUE_MESSAGE = "这首小歌还在继续生成，先去忙一会儿，稍后回来会自动接着查结果";

function shouldRetryCreateAotdSongTask(error) {
  const message = error && error.message ? String(error.message) : "";
  if (!message) {
    return false;
  }
  if (/你今天的机会已经用完了|Missing|缺少|没有创建成功制作任务/.test(message)) {
    return false;
  }
  return /真实音乐服务暂时不稳定|fetch failed|network|timeout|timed out|econnreset|enotfound|eai_again|无法连接到云托管服务/i.test(message);
}

async function requestAotdSongGeneration(payload) {
  const created = await createAotdSongTask(payload);
  return waitForAotdSongTask(created && created.task ? created.task.id : 0, {
    initialPayload: created,
    timeoutMs: AOTD_TASK_WAIT_TIMEOUT_MS,
  });
}

async function createAotdSongTask(payload) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const created = await callAotdSongApi("/api/aotd-song/generate", "POST", payload);
      const createdTask = created && created.task ? created.task : null;
      if (!createdTask || !createdTask.id) {
        throw new Error("没有创建成功制作任务");
      }
      return created;
    } catch (error) {
      lastError = error;
      if (!shouldRetryCreateAotdSongTask(error) || attempt >= 3) {
        break;
      }
      await sleep(700 * attempt);
    }
  }
  throw lastError || new Error("制作 AOTD 失败");
}

function getAotdSongTask(taskId) {
  if (!taskId) {
    return Promise.reject(new Error("缺少制作任务 ID"));
  }
  return callAotdSongApi(`/api/aotd-song/tasks/${taskId}`, "GET");
}

async function waitForAotdSongTask(taskId, options) {
  if (!taskId) {
    throw new Error("缺少制作任务 ID");
  }
  const timeoutMs = options && options.timeoutMs ? Number(options.timeoutMs) : AOTD_TASK_WAIT_TIMEOUT_MS;
  const timeoutAt = Date.now() + timeoutMs;
  let taskPayload = options && options.initialPayload ? options.initialPayload : await getAotdSongTask(taskId);
  while (Date.now() < timeoutAt) {
    if (taskPayload.task && taskPayload.task.status === "completed") {
      return {
        song: taskPayload.task.song,
        meta: taskPayload.task.meta || taskPayload.meta || {},
        task: taskPayload.task,
      };
    }
    if (taskPayload.task && taskPayload.task.status === "failed") {
      throw new Error(normalizeAotdSongErrorMessage(taskPayload.task.errorMessage, "制作 AOTD 失败"));
    }
    await sleep(taskPayload.task && taskPayload.task.status === "processing" ? 2200 : 1500);
    taskPayload = await getAotdSongTask(taskId);
  }
  throw new Error(AOTD_TASK_CONTINUE_MESSAGE);
}

module.exports = {
  requestRecommendation,
  loadResultIfMatched,
  requestWxLogin,
  requestProfile,
  updateUserProfile,
  trackUserEvent,
  requestEveningReminderStatus,
  createEveningReminder,
  createAotdSongTask,
  getAotdSongTask,
  waitForAotdSongTask,
  requestAotdSongGeneration,
};
