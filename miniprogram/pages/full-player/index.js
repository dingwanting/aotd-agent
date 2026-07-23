const { trackUserEvent } = require("../../utils/api");
const {
  API_BASE_URL,
  USE_CLOUD_CONTAINER,
  CLOUD_ENV_ID,
  CLOUD_SERVICE_NAME,
  CLOUD_SERVICE_FALLBACKS,
} = require("../../utils/config");

const AUDIO_CACHE_MIN_BYTES = 1024;
const AUDIO_FETCH_TIMEOUT_MS = 30000;

function buildTrackKeyword(track) {
  const title = (track && track.title ? track.title : "").trim();
  const artist = (track && track.artist ? track.artist : "").trim();
  const keyword = (track && track.keyword ? track.keyword : "").trim();
  return keyword || [title, artist].filter(Boolean).join(" ");
}

function buildTempAudioFilePath(track) {
  const rawName = track && (track.originalId || `${track.title || "aotd"}-${track.artist || "full"}`);
  const safeName = String(rawName || "aotd-full")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${wx.env.USER_DATA_PATH}/${safeName || "aotd-full"}-full.mp3`;
}

function readLocalAudioFile(filePath) {
  const fs = wx.getFileSystemManager();
  return new Promise((resolve) => {
    fs.getFileInfo({
      filePath,
      success: (info) => {
        resolve(Boolean(info && info.size >= AUDIO_CACHE_MIN_BYTES));
      },
      fail: () => resolve(false),
    });
  });
}

function buildAudioError(detail) {
  const message = detail && detail.message ? detail.message : "完整版加载失败，请稍后再试。";
  const error = new Error(message);
  error.code = detail && detail.code ? String(detail.code) : "";
  error.detail = detail || {};
  return error;
}

function withTimeout(task, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(buildAudioError({
        code: "FULL_AUDIO_TIMEOUT",
        message: "缓存完整版超时了，请重试一次。",
      }));
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

function fetchFullAudioViaCloudContainer(track) {
  const serviceNames = Array.from(
    new Set([CLOUD_SERVICE_NAME].concat(CLOUD_SERVICE_FALLBACKS || []).filter(Boolean))
  );
  const filePath = buildTempAudioFilePath(track);
  const fs = wx.getFileSystemManager();
  const data = {
    originalId: track.originalId || "",
    title: track.title || "",
    artist: track.artist || "",
    keyword: buildTrackKeyword(track),
    full: "1",
  };

  return new Promise((resolve, reject) => {
    const tryRequest = (index) => {
      const serviceName = serviceNames[index];
      if (!serviceName) {
        reject(buildAudioError({
          message: "当前无法连接完整版服务，请稍后重试。",
        }));
        return;
      }

      wx.cloud.callContainer({
        config: {
          env: CLOUD_ENV_ID,
        },
        path: "/api/netease/audio/stream",
        method: "GET",
        header: {
          "X-WX-SERVICE": serviceName,
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
                code: error && error.errCode ? error.errCode : "",
                message: error && error.errMsg ? error.errMsg : "完整版写入失败，请重试。",
              })),
            });
            return;
          }

          if (index < serviceNames.length - 1) {
            tryRequest(index + 1);
            return;
          }

          reject(buildAudioError({
            code: response.statusCode,
            message: response && response.data && (response.data.error || response.data.message)
              ? response.data.error || response.data.message
              : "当前没有拿到完整版音频流。",
          }));
        },
        fail: (error) => {
          if (index < serviceNames.length - 1) {
            tryRequest(index + 1);
            return;
          }
          reject(buildAudioError({
            code: error && error.errCode ? error.errCode : "",
            message: error && error.errMsg ? error.errMsg : "当前无法连接完整版服务。",
          }));
        },
      });
    };

    tryRequest(0);
  });
}

function fetchFullAudioViaHttp(track) {
  const params = [];
  if (track.originalId) {
    params.push(`originalId=${encodeURIComponent(track.originalId)}`);
  }
  if (track.title) {
    params.push(`title=${encodeURIComponent(track.title)}`);
  }
  if (track.artist) {
    params.push(`artist=${encodeURIComponent(track.artist)}`);
  }
  const keyword = buildTrackKeyword(track);
  if (keyword) {
    params.push(`keyword=${encodeURIComponent(keyword)}`);
  }
  params.push("full=1");

  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${API_BASE_URL}/api/netease/audio/stream?${params.join("&")}`,
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300 && response.tempFilePath) {
          resolve(response.tempFilePath);
          return;
        }
        reject(buildAudioError({
          code: response.statusCode,
          message: "完整版下载失败，请稍后重试。",
        }));
      },
      fail: (error) => {
        reject(buildAudioError({
          code: error && error.errCode ? error.errCode : "",
          message: error && error.errMsg ? error.errMsg : "当前无法下载完整版。",
        }));
      },
    });
  });
}

Page({
  data: {
    title: "",
    artist: "",
    keyword: "",
    originalId: "",
    loadingFullAudio: true,
    cachedReady: false,
    cachedFilePath: "",
    playing: false,
    stateText: "正在缓存完整版，第一次会稍微久一点。",
  },

  onLoad(query) {
    const track = {
      title: query && query.title ? decodeURIComponent(query.title) : "",
      artist: query && query.artist ? decodeURIComponent(query.artist) : "",
      keyword: query && query.keyword ? decodeURIComponent(query.keyword) : "",
      originalId: query && query.originalId ? decodeURIComponent(query.originalId) : "",
    };

    if (!track.title && !track.keyword) {
      wx.showToast({
        title: "完整版信息缺失",
        icon: "none",
      });
      wx.navigateBack({
        delta: 1,
      });
      return;
    }

    wx.setNavigationBarTitle({
      title: track.title || "听完整版",
    });

    this.trackInfo = track;
    this.setData(track);
    trackUserEvent({
      type: "full_player_open",
      title: track.title,
      artist: track.artist,
      originalId: track.originalId,
    }).catch(() => {});
    this.prepareFullAudio(true);
  },

  onHide() {
    if (this.audioContext) {
      this.audioContext.stop();
    }
  },

  onUnload() {
    if (this.audioContext) {
      this.audioContext.destroy();
      this.audioContext = null;
    }
  },

  ensureAudioContext() {
    if (this.audioContext) {
      return this.audioContext;
    }

    const audioContext = wx.createInnerAudioContext();
    audioContext.autoplay = true;
    audioContext.obeyMuteSwitch = false;
    audioContext.title = [this.data.title, this.data.artist].filter(Boolean).join(" - ") || "AOTD";

    audioContext.onPlay(() => {
      this.setData({
        playing: true,
        stateText: "完整版正在播放，可以直接听完。",
      });
    });

    audioContext.onStop(() => {
      this.setData({
        playing: false,
        stateText: this.data.cachedReady ? "完整版已经缓存好了，随时可以继续听。" : this.data.stateText,
      });
    });

    audioContext.onEnded(() => {
      this.setData({
        playing: false,
        stateText: "这首已经播完了，还想听可以再点一次。",
      });
    });

    audioContext.onError((error) => {
      this.setData({
        playing: false,
        stateText: error && error.errMsg ? error.errMsg : "完整版播放失败，请重试一次。",
      });
    });

    this.audioContext = audioContext;
    return audioContext;
  },

  async ensureFullAudioFile() {
    const track = this.trackInfo;
    const cachedPath = this.data.cachedFilePath || buildTempAudioFilePath(track);
    const exists = await readLocalAudioFile(cachedPath);
    if (exists) {
      return cachedPath;
    }

    if (this.fullAudioPromise) {
      return this.fullAudioPromise;
    }

    this.fullAudioPromise = withTimeout(
      USE_CLOUD_CONTAINER ? fetchFullAudioViaCloudContainer(track) : fetchFullAudioViaHttp(track),
      AUDIO_FETCH_TIMEOUT_MS
    ).finally(() => {
      this.fullAudioPromise = null;
    });

    return this.fullAudioPromise;
  },

  async prepareFullAudio(autoPlay) {
    this.setData({
      loadingFullAudio: true,
      stateText: "正在缓存完整版，第一次会稍微久一点。",
    });

    try {
      const filePath = await this.ensureFullAudioFile();
      this.setData({
        loadingFullAudio: false,
        cachedReady: Boolean(filePath),
        cachedFilePath: filePath,
        stateText: autoPlay ? "完整版已缓存，马上开始播放。" : "完整版已缓存，点下面就能完整听。",
      });
      trackUserEvent({
        type: "full_audio_cached",
        title: this.data.title,
        artist: this.data.artist,
      }).catch(() => {});
      if (autoPlay) {
        this.playFullAudio(filePath);
      }
    } catch (error) {
      const message = error && error.message ? error.message : "完整版加载失败，请稍后重试。";
      this.setData({
        loadingFullAudio: false,
        cachedReady: false,
        stateText: message,
      });
    }
  },

  playFullAudio(filePath) {
    const audioContext = this.ensureAudioContext();
    audioContext.src = filePath;
    audioContext.play();
  },

  handleTogglePlay() {
    if (this.data.loadingFullAudio) {
      return;
    }
    if (this.data.playing && this.audioContext) {
      this.audioContext.stop();
      return;
    }
    if (this.data.cachedReady && this.data.cachedFilePath) {
      this.playFullAudio(this.data.cachedFilePath);
      return;
    }
    this.prepareFullAudio(true);
  },

  handleRetryFullAudio() {
    this.prepareFullAudio(false);
  },

  handleCopyKeyword() {
    const keyword = buildTrackKeyword(this.trackInfo);
    if (!keyword) {
      wx.showToast({
        title: "没有可复制的歌名",
        icon: "none",
      });
      return;
    }

    wx.setClipboardData({
      data: keyword,
      success: () => {
        this.setData({
          stateText: "歌名已经复制好了，去网易云搜一下就行。",
        });
        trackUserEvent({
          type: "full_player_copy_keyword",
          title: this.data.title,
          artist: this.data.artist,
        }).catch(() => {});
      },
      fail: () => {
        wx.showToast({
          title: "复制失败，请重试",
          icon: "none",
        });
      },
    });
  },
});
