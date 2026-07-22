const { STORAGE_KEYS, getStorage, clearAnswers, clearQuestionDeck, clearResult } = require("../../utils/storage");
const { requestRecommendation, loadResultIfMatched, updateUserProfile, trackUserEvent } = require("../../utils/api");
const {
  API_BASE_URL,
  USE_CLOUD_CONTAINER,
  CLOUD_ENV_ID,
  CLOUD_SERVICE_NAME,
  CLOUD_SERVICE_FALLBACKS,
} = require("../../utils/config");

const SUPPORT_INLINE_AUDIO = true;
const AUDIO_FETCH_MAX_ATTEMPTS = 2;
const AUDIO_CACHE_MIN_BYTES = 1024;
const AUDIO_PREVIEW_BYTES = 256 * 1024;
const AUDIO_FETCH_TIMEOUT_MS = 15000;
const AUDIO_PLAY_START_TIMEOUT_MS = 10000;
const FALLBACK_NICKNAME = "朋友";

// 后端 playlist.title 形如 "AOTD|去探索一下咖啡店窗边"，前端去掉 "AOTD|"
// 拼上昵称变成 "{nickname}，去探索一下咖啡店窗边"
function buildCoverTitle(rawTitle, nickname) {
  const cleaned = String(rawTitle || "").replace(/^AOTD\s*\|\s*/i, "").trim();
  const who = nickname && nickname !== FALLBACK_NICKNAME ? nickname : FALLBACK_NICKNAME;
  if (!cleaned) {
    return `${who}，今晚的歌单已经备好`;
  }
  return `${who}，${cleaned}`;
}

function applyCoverTitle(result, nickname) {
  if (!result || !result.playlist) {
    return result;
  }
  return Object.assign({}, result, {
    playlist: Object.assign({}, result.playlist, {
      title: buildCoverTitle(result.playlist.title, nickname),
    }),
  });
}

function isFallbackNickname(nickname) {
  return !nickname || nickname === FALLBACK_NICKNAME;
}

function getAnswers() {
  return getStorage(STORAGE_KEYS.answers, {});
}

function buildTrackKeyword(track) {
  const song = track.song || {};
  const title = (song.title || "").trim();
  const artist = (song.artist || "").trim();
  const cliKeyword = (song.cliKeyword || "").trim();
  if (cliKeyword) {
    return cliKeyword;
  }
  return [title, artist].filter(Boolean).join(" ");
}

function buildAudioStreamUrl(track) {
  const song = track.song || {};
  const params = [];

  if (song.originalId) {
    params.push(`originalId=${encodeURIComponent(String(song.originalId))}`);
  }
  if (song.title) {
    params.push(`title=${encodeURIComponent(song.title)}`);
  }
  if (song.artist) {
    params.push(`artist=${encodeURIComponent(song.artist)}`);
  }

  const keyword = buildTrackKeyword(track);
  if (keyword) {
    params.push(`keyword=${encodeURIComponent(keyword)}`);
  }

  return `${API_BASE_URL}/api/netease/audio/stream?${params.join("&")}`;
}

function buildAudioResolveParams(track) {
  const song = track.song || {};
  return {
    originalId: song.originalId ? String(song.originalId) : "",
    title: song.title || "",
    artist: song.artist || "",
    keyword: buildTrackKeyword(track),
    previewBytes: String(AUDIO_PREVIEW_BYTES),
  };
}

function buildTempAudioFilePath(track) {
  const song = track.song || {};
  const rawName = song.originalId || `${song.title || "aotd"}-${song.artist || "preview"}`;
  const safeName = String(rawName)
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${wx.env.USER_DATA_PATH}/${safeName || "aotd-preview"}.mp3`;
}

function buildTrackSignature(track) {
  const song = track && track.song ? track.song : {};
  return [song.originalId || "", song.title || "", song.artist || ""].join("::");
}

function readErrorCode(detail) {
  if (!detail) {
    return "";
  }
  if (detail.code || detail.errorCode || detail.statusCode) {
    return String(detail.code || detail.errorCode || detail.statusCode);
  }
  return "";
}

function buildAudioError(detail) {
  const fallbackMessage = "当前无法连接试听服务。";
  const message = detail && detail.message ? detail.message : fallbackMessage;
  const error = new Error(message);
  error.code = readErrorCode(detail);
  error.detail = detail || {};
  return error;
}

function formatAudioErrorCode(error) {
  if (!error || !error.code) {
    return "";
  }
  return `（错误码：${error.code}）`;
}

function readLocalAudioFile(filePath) {
  const fs = wx.getFileSystemManager();
  return new Promise((resolve) => {
    fs.getFileInfo({
      filePath,
      success: (info) => {
        resolve(Boolean(info && info.size >= AUDIO_CACHE_MIN_BYTES));
      },
      fail: () => resolve(false)
    });
  });
}

function resolveAudioViaCloudContainer(track) {
  const data = buildAudioResolveParams(track);
  const serviceNames = Array.from(
    new Set([CLOUD_SERVICE_NAME].concat(CLOUD_SERVICE_FALLBACKS || []).filter(Boolean))
  );

  return new Promise((resolve, reject) => {
    const tryRequest = (index) => {
      const serviceName = serviceNames[index];
      if (!serviceName) {
        reject(new Error("当前无法连接试听服务，请检查云托管服务配置。"));
        return;
      }

      wx.cloud.callContainer({
        config: {
          env: CLOUD_ENV_ID
        },
        path: "/api/netease/audio/resolve",
        method: "GET",
        header: {
          "X-WX-SERVICE": serviceName
        },
        data,
        success: (response) => {
          if (response.statusCode >= 200 && response.statusCode < 300 && response.data && response.data.playable && response.data.audioUrl) {
            resolve(response.data.audioUrl);
            return;
          }

          if (index < serviceNames.length - 1) {
            tryRequest(index + 1);
            return;
          }

          const message =
            response.data && (response.data.message || response.data.error)
              ? response.data.message || response.data.error
              : "当前没有拿到可播放音频流。";
          reject(buildAudioError({
            stage: "resolve",
            statusCode: response.statusCode,
            message,
            responseData: response.data
          }));
        },
        fail: (error) => {
          if (index < serviceNames.length - 1) {
            tryRequest(index + 1);
            return;
          }

          reject(buildAudioError({
            stage: "resolve",
            code: error && error.errCode ? error.errCode : "",
            message: error && error.errMsg ? error.errMsg : "当前无法连接试听服务。",
            rawError: error
          }));
        }
      });
    };

    tryRequest(0);
  });
}

function fetchAudioTempFileViaCloudContainer(track) {
  const data = buildAudioResolveParams(track);
  const filePath = buildTempAudioFilePath(track);
  const fs = wx.getFileSystemManager();
  const serviceNames = Array.from(
    new Set([CLOUD_SERVICE_NAME].concat(CLOUD_SERVICE_FALLBACKS || []).filter(Boolean))
  );

  return new Promise((resolve, reject) => {
    const tryRequest = (index) => {
      const serviceName = serviceNames[index];
      if (!serviceName) {
        reject(new Error("当前无法连接试听服务，请检查云托管服务配置。"));
        return;
      }

      wx.cloud.callContainer({
        config: {
          env: CLOUD_ENV_ID
        },
        path: "/api/netease/audio/stream",
        method: "GET",
        header: {
          "X-WX-SERVICE": serviceName
        },
        data,
        responseType: "arraybuffer",
        success: (response) => {
          const arrayBuffer = response && response.data;
          if (response.statusCode >= 200 && response.statusCode < 300 && arrayBuffer && arrayBuffer.byteLength) {
            fs.writeFile({
              filePath,
              data: arrayBuffer,
              encoding: "binary",
              success: () => resolve(filePath),
              fail: (error) => reject(buildAudioError({
                stage: "write",
                code: error && error.errCode ? error.errCode : "",
                message: error && error.errMsg ? error.errMsg : "试听文件写入失败。",
                rawError: error
              }))
            });
            return;
          }

          if (index < serviceNames.length - 1) {
            tryRequest(index + 1);
            return;
          }

          // 如果流式拉取失败，再退回到直链播放方案，尽量保住可用率。
          resolveAudioViaCloudContainer(track)
            .then(resolve)
            .catch((error) => reject(error));
        },
        fail: (error) => {
          if (index < serviceNames.length - 1) {
            tryRequest(index + 1);
            return;
          }

          resolveAudioViaCloudContainer(track)
            .then(resolve)
            .catch(() => reject(buildAudioError({
              stage: "stream",
              code: error && error.errCode ? error.errCode : "",
              message: error && error.errMsg ? error.errMsg : "当前无法连接试听服务。",
              rawError: error
            })));
        }
      });
    };

    tryRequest(0);
  });
}

function withTimeout(task, timeoutMs, detail) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(buildAudioError(Object.assign({
        code: "AUDIO_TIMEOUT",
        message: "试听加载超时，请稍后重试。"
      }, detail || {})));
    }, timeoutMs);

    Promise.resolve(task)
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

Page({
  data: {
    loading: true,
    errorMessage: "",
    result: null,
    copiedTrackIndex: -1,
    supportsInlineAudio: SUPPORT_INLINE_AUDIO,
    playingTrackIndex: -1,
    loadingTrackIndex: -1,
    audioRetryCount: 0,
    showNicknameAuth: false
  },

  onShow() {
    this.audioFilePromiseCache = this.audioFilePromiseCache || {};
    this.audioErrorLogs = this.audioErrorLogs || [];
    this.autoAdvanceOnEnd = false;
    this.autoAdvanceTimer = null;
    this.loadResult();
  },

  onUnload() {
    if (this.autoPlayTimer) {
      clearTimeout(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
    if (this.autoAdvanceTimer) {
      clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
    }
    this.destroyAudio();
  },

  onHide() {
    if (this.autoPlayTimer) {
      clearTimeout(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
    if (this.autoAdvanceTimer) {
      clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
    }
    if (this.audioContext) {
      this.audioContext.stop();
      this.autoAdvanceOnEnd = false;
      this.setData({
        playingTrackIndex: -1,
        loadingTrackIndex: -1
      });
    }
  },

  async loadResult() {
    const answers = getAnswers();
    if (!answers.consumptionSource || !answers.emotionalNeed || !answers.emotionalImagery) {
      wx.redirectTo({
        url: "/pages/question/index?step=consumptionSource"
      });
      return;
    }

    const nickname = getStorage(STORAGE_KEYS.nickname, FALLBACK_NICKNAME);

    const cached = loadResultIfMatched(answers);
    if (cached) {
      this.setData({
        loading: false,
        errorMessage: "",
        result: applyCoverTitle(cached, nickname),
        copiedTrackIndex: -1,
        playingTrackIndex: -1,
        loadingTrackIndex: -1,
        showNicknameAuth: isFallbackNickname(nickname)
      });
      trackUserEvent({ type: "result_view_cached", answers }).catch(() => {});
      this.autoPlayTopTrack(cached);
      return;
    }

    this.setData({
      loading: true,
      errorMessage: "",
      result: null
    });

    try {
      const result = await requestRecommendation(answers);
      this.setData({
        loading: false,
        result: applyCoverTitle(result, nickname),
        copiedTrackIndex: -1,
        playingTrackIndex: -1,
        loadingTrackIndex: -1,
        showNicknameAuth: isFallbackNickname(nickname)
      });
      trackUserEvent({ type: "result_view", answers }).catch(() => {});
      this.autoPlayTopTrack(result);
    } catch (error) {
      this.setData({
        loading: false,
        errorMessage: error && error.message ? error.message : "生成歌单失败，请稍后再试。"
      });
    }
  },

  handleRetry() {
    this.loadResult();
  },

  logAudioError(detail) {
    const nextDetail = Object.assign(
      {
        time: new Date().toISOString()
      },
      detail || {}
    );
    this.audioErrorLogs = this.audioErrorLogs || [];
    this.audioErrorLogs.push(nextDetail);
    if (this.audioErrorLogs.length > 20) {
      this.audioErrorLogs = this.audioErrorLogs.slice(-20);
    }
    console.error("AOTD audio error", nextDetail);
  },

  handleRestart() {
    if (this.autoPlayTimer) {
      clearTimeout(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
    if (this.autoAdvanceTimer) {
      clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
    }
    this.autoAdvanceOnEnd = false;
    this.destroyAudio();
    this.lastAutoPlaySignature = "";
    clearAnswers();
    clearQuestionDeck();
    clearResult();
    trackUserEvent({ type: "restart_questionnaire" }).catch(() => {});
    wx.redirectTo({
      url: "/pages/landing/index"
    });
  },

  handleCopyTrack(event) {
    const { index } = event.currentTarget.dataset;
    const result = this.data.result;
    const track = result && result.playlist && result.playlist.tracks ? result.playlist.tracks[index] : null;
    if (!track) {
      return;
    }

    const keyword = buildTrackKeyword(track);
    wx.setClipboardData({
      data: keyword,
      success: () => {
        this.setData({
          copiedTrackIndex: Number(index)
        });
        trackUserEvent({
          type: "track_copy",
          trackRank: track.rank,
          title: track.song && track.song.title,
          artist: track.song && track.song.artist
        }).catch(() => {});
        wx.showModal({
          title: "已复制到剪贴板",
          content: `已复制“${keyword}”。打开网易云音乐后直接粘贴搜索，通常可以较快命中这首歌。`,
          showCancel: false
        });
      }
    });
  },

  autoPlayTopTrack(result) {
    const tracks = result && result.playlist && result.playlist.tracks ? result.playlist.tracks : [];
    if (!tracks.length) {
      return;
    }

    const topTrack = tracks[0];
    const song = topTrack.song || {};
    const signature = `${song.originalId || ""}-${song.title || ""}-${song.artist || ""}`;
    if (this.lastAutoPlaySignature === signature) {
      return;
    }

    this.lastAutoPlaySignature = signature;
    if (this.autoPlayTimer) {
      clearTimeout(this.autoPlayTimer);
    }
    this.autoPlayTimer = setTimeout(() => {
      this.autoPlayTimer = null;
      this.handlePlayTrack({
        currentTarget: {
          dataset: {
            index: 0
          }
        }
      });
    }, 180);
  },

  async handleAuthorizeNickname() {
    if (typeof wx.getUserProfile !== "function") {
      wx.showToast({
        title: "当前版本不支持昵称授权",
        icon: "none"
      });
      return;
    }

    try {
      const profile = await new Promise((resolve, reject) => {
        wx.getUserProfile({
          desc: "用于在歌单封面展示你的昵称",
          success: resolve,
          fail: reject
        });
      });
      const nickname =
        profile &&
        profile.userInfo &&
        typeof profile.userInfo.nickName === "string"
          ? profile.userInfo.nickName.trim()
          : "";
      if (!nickname) {
        wx.showToast({
          title: "没有拿到昵称",
          icon: "none"
        });
        return;
      }
      await updateUserProfile(nickname);
      const current = this.data.result;
      this.setData({
        showNicknameAuth: false,
        result: applyCoverTitle(current, nickname)
      });
      trackUserEvent({ type: "nickname_authorized", nickname }).catch(() => {});
      wx.showToast({
        title: "昵称已同步",
        icon: "success"
      });
    } catch (error) {
      const errMsg = error && error.errMsg ? error.errMsg : "";
      if (errMsg.includes("cancel")) {
        return;
      }
      wx.showToast({
        title: "昵称授权失败",
        icon: "none"
      });
    }
  },

  ensureAudioContext() {
    if (this.audioContext) {
      return this.audioContext;
    }

    const audioContext = wx.createInnerAudioContext();
    audioContext.autoplay = true;
    audioContext.obeyMuteSwitch = false;

    audioContext.onCanplay(() => {
      if (this.playStartWatchdogTimer) {
        clearTimeout(this.playStartWatchdogTimer);
        this.playStartWatchdogTimer = null;
      }
      this.setData({
        loadingTrackIndex: -1
      });
    });

    audioContext.onPlay(() => {
      if (this.playStartWatchdogTimer) {
        clearTimeout(this.playStartWatchdogTimer);
        this.playStartWatchdogTimer = null;
      }
      this.setData({
        playingTrackIndex: this.pendingTrackIndex,
        loadingTrackIndex: -1
      });
    });

    audioContext.onStop(() => {
      if (this.playStartWatchdogTimer) {
        clearTimeout(this.playStartWatchdogTimer);
        this.playStartWatchdogTimer = null;
      }
      // 手动暂停、切歌、页面隐藏等都会触发 onStop —— 这种"非自然结束"不应该轮播
      this.autoAdvanceOnEnd = false;
      this.setData({
        playingTrackIndex: -1,
        loadingTrackIndex: -1
      });
    });

    audioContext.onEnded(() => {
      if (this.playStartWatchdogTimer) {
        clearTimeout(this.playStartWatchdogTimer);
        this.playStartWatchdogTimer = null;
      }
      const endedIndex = this.pendingTrackIndex;
      const tracks = this.data.result && this.data.result.playlist ? this.data.result.playlist.tracks : [];
      // 试听自然结束 -> 自动轮播到下一首；最后一首播完就停在原位
      if (this.autoAdvanceOnEnd && endedIndex >= 0 && endedIndex < tracks.length - 1) {
        this.autoAdvanceOnEnd = true;
        this.setData({
          playingTrackIndex: -1,
          loadingTrackIndex: -1
        });
        // 短暂延后避免 onPlay/onEnded 事件链过近
        this.autoAdvanceTimer = setTimeout(() => {
          this.autoAdvanceTimer = null;
          this.handlePlayTrack({
            currentTarget: {
              dataset: { index: endedIndex + 1 }
            }
          });
        }, 320);
        return;
      }
      this.autoAdvanceOnEnd = false;
      this.setData({
        playingTrackIndex: -1,
        loadingTrackIndex: -1
      });
    });

    audioContext.onError((error) => {
      const filePath = this.currentAudioFilePath;
      const song = this.pendingTrack && this.pendingTrack.song ? this.pendingTrack.song : {};
      if (this.playStartWatchdogTimer) {
        clearTimeout(this.playStartWatchdogTimer);
        this.playStartWatchdogTimer = null;
      }
      this.logAudioError({
        stage: "playback",
        code: error && error.errCode ? error.errCode : "",
        message: error && error.errMsg ? error.errMsg : "InnerAudioContext 播放失败",
        trackTitle: song.title || "",
        trackArtist: song.artist || "",
        trackIndex: this.pendingTrackIndex
      });
      if (filePath) {
        wx.getFileSystemManager().unlink({
          filePath,
          fail: () => {}
        });
        this.currentAudioFilePath = "";
      }
      this.setData({
        playingTrackIndex: -1,
        loadingTrackIndex: -1
      });
      wx.showModal({
        title: "当前无法播放",
        content: `这首歌暂时没有稳定拿到可播放音频流${formatAudioErrorCode(error)}，你可以先复制歌名到网易云搜索。`,
        showCancel: false
      });
    });

    this.audioContext = audioContext;
    return audioContext;
  },

  destroyAudio() {
    if (this.playStartWatchdogTimer) {
      clearTimeout(this.playStartWatchdogTimer);
      this.playStartWatchdogTimer = null;
    }
    if (this.autoAdvanceTimer) {
      clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
    }
    this.autoAdvanceOnEnd = false;
    if (this.audioContext) {
      this.audioContext.destroy();
      this.audioContext = null;
      this.pendingTrackIndex = -1;
      this.pendingTrack = null;
    }

    if (this.currentAudioFilePath) {
      wx.getFileSystemManager().unlink({
        filePath: this.currentAudioFilePath,
        fail: () => {}
      });
      this.currentAudioFilePath = "";
    }
  },

  async getCachedAudioFile(track) {
    const filePath = buildTempAudioFilePath(track);
    const exists = await readLocalAudioFile(filePath);
    if (exists) {
      return filePath;
    }
    return "";
  },

  async resolvePlayableAudio(track) {
    const trackSignature = buildTrackSignature(track);
    const cachedFilePath = await this.getCachedAudioFile(track);
    if (cachedFilePath) {
      return {
        audioUrl: cachedFilePath,
        fromCache: true
      };
    }

    if (this.audioFilePromiseCache && this.audioFilePromiseCache[trackSignature]) {
      return this.audioFilePromiseCache[trackSignature];
    }

    const fetchPromise = Promise.resolve()
      .then(() => {
        if (USE_CLOUD_CONTAINER) {
          return withTimeout(
            fetchAudioTempFileViaCloudContainer(track),
            AUDIO_FETCH_TIMEOUT_MS,
            { stage: "stream_timeout" }
          );
        }
        return buildAudioStreamUrl(track);
      })
      .then((audioUrl) => ({
        audioUrl,
        fromCache: false
      }))
      .finally(() => {
        if (this.audioFilePromiseCache) {
          delete this.audioFilePromiseCache[trackSignature];
        }
      });

    this.audioFilePromiseCache = this.audioFilePromiseCache || {};
    this.audioFilePromiseCache[trackSignature] = fetchPromise;
    return fetchPromise;
  },

  async fetchPlayableAudioWithRetry(track) {
    let attempt = 0;
    let lastError = null;

    while (attempt < AUDIO_FETCH_MAX_ATTEMPTS) {
      attempt += 1;
      try {
        const result = await this.resolvePlayableAudio(track);
        this.setData({
          audioRetryCount: Math.max(0, attempt - 1)
        });
        return result;
      } catch (error) {
        lastError = error;
        const song = track && track.song ? track.song : {};
        this.logAudioError({
          stage: "fetch",
          code: error && error.code ? error.code : "",
          message: error && error.message ? error.message : "试听拉流失败",
          attempt,
          trackTitle: song.title || "",
          trackArtist: song.artist || "",
          trackOriginalId: song.originalId || ""
        });
      }
    }

    throw lastError || buildAudioError({ message: "当前无法连接试听服务。" });
  },

  handlePlayTrack(event) {
    const { index } = event.currentTarget.dataset;
    const numericIndex = Number(index);
    const result = this.data.result;
    const track = result && result.playlist && result.playlist.tracks ? result.playlist.tracks[numericIndex] : null;
    if (!track) {
      return;
    }

    const audioContext = this.ensureAudioContext();
    if (this.data.playingTrackIndex === numericIndex) {
      audioContext.stop();
      return;
    }

    this.pendingTrackIndex = numericIndex;
    this.pendingTrack = track;
    // 每次开始播放都启用自动轮播：onEnded 时若仍是 true，就轮播到下一首
    this.autoAdvanceOnEnd = true;
    if (this.playStartWatchdogTimer) {
      clearTimeout(this.playStartWatchdogTimer);
      this.playStartWatchdogTimer = null;
    }
    this.setData({
      loadingTrackIndex: numericIndex,
      playingTrackIndex: -1,
      audioRetryCount: 0
    });
    trackUserEvent({
      type: "track_play",
      trackRank: track.rank,
      title: track.song && track.song.title,
      artist: track.song && track.song.artist
    }).catch(() => {});

    const song = track.song || {};
    audioContext.title = [song.title, song.artist].filter(Boolean).join(" - ") || "AOTD";

    this.fetchPlayableAudioWithRetry(track)
      .then(({ audioUrl }) => {
        if (this.pendingTrackIndex !== numericIndex) {
          return;
        }
        if (audioUrl.indexOf(wx.env.USER_DATA_PATH) === 0) {
          this.currentAudioFilePath = audioUrl;
        } else {
          this.currentAudioFilePath = "";
        }
        audioContext.src = audioUrl;
        this.playStartWatchdogTimer = setTimeout(() => {
          this.playStartWatchdogTimer = null;
          if (this.data.playingTrackIndex === numericIndex || this.pendingTrackIndex !== numericIndex) {
            return;
          }
          this.logAudioError({
            stage: "play_start_timeout",
            code: "PLAY_START_TIMEOUT",
            message: "音频源已设置但播放未启动，触发播放启动超时保护。",
            trackIndex: numericIndex
          });
          audioContext.stop();
          this.setData({
            loadingTrackIndex: -1,
            playingTrackIndex: -1
          });
          wx.showModal({
            title: "当前无法播放",
            content: "试听启动超时，已自动中断本次缓冲。你可以重试或复制歌名到网易云搜索。",
            showCancel: false
          });
        }, AUDIO_PLAY_START_TIMEOUT_MS);
      })
      .catch((error) => {
        if (this.playStartWatchdogTimer) {
          clearTimeout(this.playStartWatchdogTimer);
          this.playStartWatchdogTimer = null;
        }
        this.setData({
          loadingTrackIndex: -1,
          playingTrackIndex: -1
        });
        wx.showModal({
          title: "当前无法播放",
          content: error && error.message
            ? `${error.message}${formatAudioErrorCode(error)}`
            : "这首歌暂时没有拿到可播放音频流，你可以先复制歌名到网易云搜索。",
          showCancel: false
        });
      });
  }
});
