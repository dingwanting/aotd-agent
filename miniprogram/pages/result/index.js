const { STORAGE_KEYS, getStorage, clearAnswers, clearQuestionDeck, clearResult } = require("../../utils/storage");
const { requestRecommendation, loadResultIfMatched } = require("../../utils/api");
const {
  API_BASE_URL,
  USE_CLOUD_CONTAINER,
  CLOUD_ENV_ID,
  CLOUD_SERVICE_NAME,
  CLOUD_SERVICE_FALLBACKS,
} = require("../../utils/config");

const SUPPORT_INLINE_AUDIO = true;

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
  };
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
          reject(new Error(message));
        },
        fail: (error) => {
          if (index < serviceNames.length - 1) {
            tryRequest(index + 1);
            return;
          }

          reject(new Error(error && error.errMsg ? error.errMsg : "当前无法连接试听服务。"));
        }
      });
    };

    tryRequest(0);
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
    loadingTrackIndex: -1
  },

  onShow() {
    this.loadResult();
  },

  onUnload() {
    this.destroyAudio();
  },

  onHide() {
    if (this.audioContext) {
      this.audioContext.stop();
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

    const cached = loadResultIfMatched(answers);
    if (cached) {
      this.setData({
        loading: false,
        errorMessage: "",
        result: cached,
        copiedTrackIndex: -1,
        playingTrackIndex: -1,
        loadingTrackIndex: -1
      });
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
        result,
        copiedTrackIndex: -1,
        playingTrackIndex: -1,
        loadingTrackIndex: -1
      });
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

  handleRestart() {
    this.destroyAudio();
    clearAnswers();
    clearQuestionDeck();
    clearResult();
    wx.redirectTo({
      url: "/pages/question/index?step=consumptionSource"
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
        wx.showModal({
          title: "已复制到剪贴板",
          content: `已复制“${keyword}”。打开网易云音乐后直接粘贴搜索，通常可以较快命中这首歌。`,
          showCancel: false
        });
      }
    });
  },

  ensureAudioContext() {
    if (this.audioContext) {
      return this.audioContext;
    }

    const audioContext = wx.createInnerAudioContext();
    audioContext.autoplay = true;
    audioContext.obeyMuteSwitch = false;

    audioContext.onCanplay(() => {
      this.setData({
        loadingTrackIndex: -1
      });
    });

    audioContext.onPlay(() => {
      this.setData({
        playingTrackIndex: this.pendingTrackIndex,
        loadingTrackIndex: -1
      });
    });

    audioContext.onStop(() => {
      this.setData({
        playingTrackIndex: -1,
        loadingTrackIndex: -1
      });
    });

    audioContext.onEnded(() => {
      this.setData({
        playingTrackIndex: -1,
        loadingTrackIndex: -1
      });
    });

    audioContext.onError(() => {
      this.setData({
        playingTrackIndex: -1,
        loadingTrackIndex: -1
      });
      wx.showModal({
        title: "当前无法播放",
        content: "这首歌暂时没有稳定拿到可播放音频流，你可以先复制到网易云继续听。",
        showCancel: false
      });
    });

    this.audioContext = audioContext;
    return audioContext;
  },

  destroyAudio() {
    if (this.audioContext) {
      this.audioContext.destroy();
      this.audioContext = null;
      this.pendingTrackIndex = -1;
    }
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
    this.setData({
      loadingTrackIndex: numericIndex,
      playingTrackIndex: -1
    });

    const song = track.song || {};
    audioContext.title = [song.title, song.artist].filter(Boolean).join(" - ") || "AOTD";

    Promise.resolve()
      .then(() => {
        if (USE_CLOUD_CONTAINER) {
          return resolveAudioViaCloudContainer(track);
        }
        return buildAudioStreamUrl(track);
      })
      .then((audioUrl) => {
        if (this.pendingTrackIndex !== numericIndex) {
          return;
        }
        audioContext.src = audioUrl;
      })
      .catch((error) => {
        this.setData({
          loadingTrackIndex: -1,
          playingTrackIndex: -1
        });
        wx.showModal({
          title: "当前无法播放",
          content: error && error.message ? error.message : "这首歌暂时没有拿到可播放音频流，你可以先复制到网易云继续听。",
          showCancel: false
        });
      });
  }
});
