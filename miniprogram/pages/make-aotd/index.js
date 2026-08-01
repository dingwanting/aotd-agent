const { STORAGE_KEYS, getStorage } = require("../../utils/storage");
const { requestAotdSongGeneration, trackUserEvent } = require("../../utils/api");
const {
  API_BASE_URL,
  USE_CLOUD_CONTAINER,
  CLOUD_ENV_ID,
  CLOUD_SERVICE_NAME,
  CLOUD_SERVICE_FALLBACKS,
} = require("../../utils/config");

const MAX_RECORD_DURATION_MS = 12000;
const MIN_RECORD_DURATION_MS = 8000;

function stripPlaylistPrefix(rawTitle) {
  return String(rawTitle || "").replace(/^AOTD\s*\|\s*/i, "").trim() || "今晚的陪伴";
}

function formatDuration(ms) {
  const totalSeconds = Math.max(1, Math.round((ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function mapTrackForSongGeneration(track) {
  const song = track && track.song ? track.song : {};
  return {
    title: song.title || "",
    artist: song.artist || "",
    originalId: song.originalId ? String(song.originalId) : undefined,
    genre: song.genre || undefined,
    moods: Array.isArray(song.moods) ? song.moods : [],
    scenes: Array.isArray(song.scenes) ? song.scenes : [],
    tags: Array.isArray(song.tags) ? song.tags : [],
    language: song.language || undefined,
    energy: song.energy || undefined,
  };
}

function getFileExtension(filePath) {
  const match = String(filePath || "").match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  return match && match[1] ? match[1].toLowerCase() : "mp3";
}

function buildSavedSongFilePath(song) {
  const rawName = song && song.title ? song.title : `aotd-song-${Date.now()}`;
  const safeName = String(rawName)
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${wx.env.USER_DATA_PATH}/${safeName || "aotd-song"}.mp3`;
}

function inferAudioExtension(url) {
  const match = String(url || "").match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  return match && match[1] ? match[1].toLowerCase() : "mp3";
}

function buildGeneratedSongTempFilePath(song, sourceUrl) {
  const rawName = song && song.title ? song.title : `aotd-song-${Date.now()}`;
  const safeName = String(rawName)
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const extension = inferAudioExtension(sourceUrl);
  return `${wx.env.USER_DATA_PATH}/${safeName || "aotd-song-preview"}.${extension}`;
}

function extractCloudContainerPath(urlOrPath) {
  if (!urlOrPath) {
    return "";
  }
  const normalized = String(urlOrPath);
  if (/^https?:\/\//i.test(normalized)) {
    if (normalized.indexOf(API_BASE_URL) !== 0) {
      return "";
    }
    const path = normalized.slice(API_BASE_URL.length);
    return path.startsWith("/") ? path : `/${path}`;
  }
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function unlinkFileIfExists(filePath) {
  if (!filePath) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    wx.getFileSystemManager().unlink({
      filePath,
      success: resolve,
      fail: () => resolve(),
    });
  });
}

function copyFileWithOverwrite(srcPath, destPath) {
  if (!srcPath || !destPath) {
    return Promise.reject(new Error("缺少文件路径"));
  }
  if (srcPath === destPath) {
    return Promise.resolve(destPath);
  }
  return unlinkFileIfExists(destPath).then(
    () =>
      new Promise((resolve, reject) => {
        wx.getFileSystemManager().copyFile({
          srcPath,
          destPath,
          success: () => resolve(destPath),
          fail: reject,
        });
      })
  );
}

function readLocalAudioFile(filePath) {
  const fs = wx.getFileSystemManager();
  return new Promise((resolve) => {
    fs.getFileInfo({
      filePath,
      success: (info) => {
        resolve(Boolean(info && info.size > 0));
      },
      fail: () => resolve(false),
    });
  });
}

function fetchGeneratedSongTempFileViaCloudContainer(sourceUrl, song) {
  const path = extractCloudContainerPath(sourceUrl);
  if (!path) {
    return Promise.reject(new Error("当前音频地址不支持云托管拉取"));
  }

  const filePath = buildGeneratedSongTempFilePath(song, sourceUrl);
  const fs = wx.getFileSystemManager();
  const serviceNames = Array.from(
    new Set([CLOUD_SERVICE_NAME].concat(CLOUD_SERVICE_FALLBACKS || []).filter(Boolean))
  );

  return new Promise((resolve, reject) => {
    const tryRequest = (index) => {
      const serviceName = serviceNames[index];
      if (!serviceName) {
        reject(new Error("当前无法连接歌曲播放服务，请检查云托管配置。"));
        return;
      }

      wx.cloud.callContainer({
        config: {
          env: CLOUD_ENV_ID,
        },
        path,
        method: "GET",
        header: {
          "X-WX-SERVICE": serviceName,
        },
        responseType: "arraybuffer",
        success: (response) => {
          const arrayBuffer = response && response.data;
          if (response.statusCode >= 200 && response.statusCode < 300 && arrayBuffer && arrayBuffer.byteLength) {
            fs.writeFile({
              filePath,
              data: arrayBuffer,
              encoding: "binary",
              success: () => resolve(filePath),
              fail: (error) =>
                reject(new Error((error && error.errMsg) || "歌曲文件写入失败。")),
            });
            return;
          }

          if (index < serviceNames.length - 1) {
            tryRequest(index + 1);
            return;
          }

          reject(new Error(`歌曲下载失败(${response && response.statusCode ? response.statusCode : "unknown"})`));
        },
        fail: (error) => {
          if (index < serviceNames.length - 1) {
            tryRequest(index + 1);
            return;
          }

          reject(new Error((error && error.errMsg) || "当前无法连接歌曲播放服务。"));
        },
      });
    };

    tryRequest(0);
  });
}

async function persistAudioToLocalFile(song, sourcePathOrUrl) {
  const targetPath = buildSavedSongFilePath(song);
  if (!sourcePathOrUrl) {
    throw new Error("没有拿到可保存的音频文件");
  }
  if (sourcePathOrUrl.indexOf(wx.env.USER_DATA_PATH) === 0) {
    return copyFileWithOverwrite(sourcePathOrUrl, targetPath);
  }
  const download = await new Promise((resolve, reject) => {
    wx.downloadFile({
      url: sourcePathOrUrl,
      success: (res) => {
        if (!res || res.statusCode < 200 || res.statusCode >= 300 || !(res.tempFilePath || res.filePath)) {
          reject(new Error(`音频下载失败(${res && res.statusCode ? res.statusCode : "unknown"})`));
          return;
        }
        resolve(res);
      },
      fail: reject,
    });
  });
  const tempFilePath = download && (download.tempFilePath || download.filePath);
  if (!tempFilePath) {
    throw new Error("没有拿到可保存的音频文件");
  }
  return copyFileWithOverwrite(tempFilePath, targetPath);
}

Page({
  data: {
    loading: true,
    errorMessage: "",
    result: null,
    titleText: "",
    recording: false,
    recordDurationText: "0:00",
    voiceReady: false,
    voiceTempFilePath: "",
    voiceDurationMs: 0,
    voiceStatusText: "还没有录音，连续说两三句，让这首歌更像你的声音。",
    generating: false,
    generationText: "正在为你制作...",
    songResult: null,
    songMetaText: "",
    generationNote: "",
    playingSong: false,
    playingVoiceSample: false,
    savedSongPath: "",
  },

  onLoad() {
    const result = getStorage(STORAGE_KEYS.result, null);
    if (!result || !result.playlist || !Array.isArray(result.playlist.tracks) || !result.playlist.tracks.length) {
      this.setData({
        loading: false,
        errorMessage: "还没有拿到今晚歌单，先回结果页生成一次吧。",
      });
      return;
    }

    this.ensureRecorderManager();
    this.setData({
      loading: false,
      result,
      titleText: stripPlaylistPrefix(result.playlist.title),
    });
  },

  onUnload() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
    if (this.audioContext) {
      this.audioContext.destroy();
      this.audioContext = null;
    }
    this.generatedSongTempFilePath = "";
    this.generatedSongSourceUrl = "";
  },

  ensureRecorderManager() {
    if (this.recorderManager || typeof wx.getRecorderManager !== "function") {
      return this.recorderManager;
    }

    const recorderManager = wx.getRecorderManager();
    recorderManager.onStart(() => {
      this.recordStartedAt = Date.now();
      if (this.recordingTimer) {
        clearInterval(this.recordingTimer);
      }
      this.recordingTimer = setInterval(() => {
        const durationMs = Date.now() - this.recordStartedAt;
        this.setData({
          recordDurationText: formatDuration(durationMs),
        });
      }, 250);
      this.setData({
        recording: true,
        recordDurationText: "0:00",
        voiceStatusText: "正在录音，连续说两三句，语气自然一点就好。",
      });
    });

    recorderManager.onStop((res) => {
      if (this.recordingTimer) {
        clearInterval(this.recordingTimer);
        this.recordingTimer = null;
      }
      const durationMs = Date.now() - (this.recordStartedAt || Date.now());
      const nextDuration = res && typeof res.duration === "number" ? res.duration : durationMs;
      this.setData({
        recording: false,
        voiceReady: Boolean(res && res.tempFilePath),
        voiceTempFilePath: res && res.tempFilePath ? res.tempFilePath : "",
        voiceDurationMs: nextDuration,
        recordDurationText: formatDuration(nextDuration),
        voiceStatusText: res && res.tempFilePath ? `录好了，时长 ${formatDuration(nextDuration)}` : "录音失败，请再试一次。",
      });
    });

    recorderManager.onError((error) => {
      if (this.recordingTimer) {
        clearInterval(this.recordingTimer);
        this.recordingTimer = null;
      }
      this.setData({
        recording: false,
        voiceStatusText: error && error.errMsg ? error.errMsg : "录音失败，请重试。",
      });
    });

    this.recorderManager = recorderManager;
    return recorderManager;
  },

  ensureAudioContext() {
    if (this.audioContext) {
      return this.audioContext;
    }
    const audioContext = wx.createInnerAudioContext();
    audioContext.autoplay = true;
    audioContext.obeyMuteSwitch = false;
    audioContext.onStop(() => {
      this.setData({
        playingSong: false,
        playingVoiceSample: false,
      });
    });
    audioContext.onEnded(() => {
      this.setData({
        playingSong: false,
        playingVoiceSample: false,
      });
    });
    audioContext.onError(() => {
      this.setData({
        playingSong: false,
        playingVoiceSample: false,
      });
      wx.showToast({
        title: "播放失败，请重试",
        icon: "none",
      });
    });
    this.audioContext = audioContext;
    return audioContext;
  },

  handleTitleInput(event) {
    this.setData({
      titleText: event && event.detail ? event.detail.value : "",
    });
  },

  handleBackToResult() {
    wx.navigateBack({
      delta: 1,
    });
  },

  async handleStartRecord() {
    if (this.data.recording) {
      return;
    }
    try {
      await new Promise((resolve, reject) => {
        wx.authorize({
          scope: "scope.record",
          success: resolve,
          fail: reject,
        });
      }).catch(() => Promise.resolve());
      const recorderManager = this.ensureRecorderManager();
      recorderManager.start({
        duration: MAX_RECORD_DURATION_MS,
        format: "mp3",
        numberOfChannels: 1,
        sampleRate: 16000,
        encodeBitRate: 32000,
      });
    } catch (error) {
      wx.showToast({
        title: "需要录音权限",
        icon: "none",
      });
    }
  },

  handleStopRecord() {
    if (!this.data.recording || !this.recorderManager) {
      return;
    }
    this.recorderManager.stop();
  },

  handleClearVoice() {
    this.setData({
      voiceReady: false,
      voiceTempFilePath: "",
      voiceDurationMs: 0,
      recordDurationText: "0:00",
      voiceStatusText: "已清空，重新录一遍吧，尽量说满 8 秒。",
      songResult: null,
      songMetaText: "",
      generationNote: "",
      savedSongPath: "",
      playingSong: false,
      playingVoiceSample: false,
    });
  },

  readVoiceBase64(filePath) {
    const fs = wx.getFileSystemManager();
    return new Promise((resolve, reject) => {
      fs.readFile({
        filePath,
        encoding: "base64",
        success: (res) => resolve(res.data || ""),
        fail: reject,
      });
    });
  },

  async uploadVoiceFile(filePath) {
    if (!wx.cloud || typeof wx.cloud.uploadFile !== "function" || typeof wx.cloud.getTempFileURL !== "function") {
      throw new Error("当前环境不支持录音上传");
    }
    const userId = getStorage(STORAGE_KEYS.userId, "guest");
    const extension = getFileExtension(filePath);
    const cloudPath = `aotd/voice-sample/${userId}/${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
    const uploaded = await wx.cloud.uploadFile({
      cloudPath,
      filePath,
    });
    const tempUrlResult = await wx.cloud.getTempFileURL({
      fileList: [uploaded.fileID],
    });
    const tempFile = tempUrlResult && Array.isArray(tempUrlResult.fileList) ? tempUrlResult.fileList[0] : null;
    const tempUrl = tempFile && tempFile.tempFileURL ? tempFile.tempFileURL : "";
    if (!tempUrl) {
      throw new Error("没有拿到录音上传地址");
    }
    return {
      fileID: uploaded.fileID,
      tempFileURL: tempUrl,
    };
  },

  async handleGenerateSong() {
    const result = this.data.result;
    const titleText = String(this.data.titleText || "").trim();
    const voiceTempFilePath = this.data.voiceTempFilePath;
    if (!titleText) {
      wx.showToast({
        title: "先输入主标题",
        icon: "none",
      });
      return;
    }
    if (!this.data.voiceReady || !voiceTempFilePath) {
      wx.showToast({
        title: "先录一段标题语音",
        icon: "none",
      });
      return;
    }
    if (this.data.voiceDurationMs < MIN_RECORD_DURATION_MS) {
      wx.showToast({
        title: "语音太短了，至少录 8 秒",
        icon: "none",
      });
      return;
    }
    this.setData({
      generating: true,
      generationText: "正在整理你的录音和歌单气质...",
    });

    try {
      const voiceFormat = getFileExtension(voiceTempFilePath);
      let voiceBase64 = "";
      let voiceSourceUrl = "";

      this.setData({
        generationText: "正在整理录音...",
      });

      try {
        voiceBase64 = await this.readVoiceBase64(voiceTempFilePath);
      } catch (error) {
        console.warn("[make-aotd] read voice base64 failed", error);
      }

      if (!voiceBase64) {
        this.setData({
          generationText: "正在上传录音...",
        });
        const uploadedVoice = await this.uploadVoiceFile(voiceTempFilePath);
        voiceSourceUrl = uploadedVoice.tempFileURL || "";
      }

      if (!voiceBase64 && !voiceSourceUrl) {
        throw new Error("录音读取失败，请重新录一遍");
      }

      this.setData({
        generationText: "正在生成专属 AOTD 小歌...",
      });
      const payload = await requestAotdSongGeneration({
        titleText,
        playlistTitle: result.playlist.title,
        answers: result.answers,
        tracks: result.playlist.tracks.map(mapTrackForSongGeneration),
        voiceBase64,
        voiceSourceUrl,
        voiceFormat,
        voiceDurationMs: this.data.voiceDurationMs,
      });
      const song = payload.song || {};
      this.setData({
        generating: false,
        generationText: "正在为你制作...",
        songResult: song,
        songMetaText: `${Math.round(song.durationSeconds || 0)} 秒 · ${song.mode === "demo" ? "Demo 音轨" : "专属歌曲"}`,
        generationNote: payload.meta && payload.meta.note ? payload.meta.note : "",
        savedSongPath: "",
      });
      trackUserEvent({
        type: "aotd_song_generate_success",
        titleText,
        durationSeconds: song.durationSeconds,
        mode: song.mode,
      }).catch(() => {});
    } catch (error) {
      this.setData({
        generating: false,
        generationText: "正在为你制作...",
      });
      wx.showToast({
        title: error && error.message ? error.message : "制作失败，请稍后再试",
        icon: "none",
      });
    }
  },

  playAudio(url, type) {
    if (!url) {
      return;
    }
    const audioContext = this.ensureAudioContext();
    audioContext.src = url;
    audioContext.title = type === "voice" ? "AOTD 标题录音" : "我的 AOTD 小歌";
    audioContext.play();
    this.setData({
      playingSong: type === "song",
      playingVoiceSample: type === "voice",
    });
  },

  async resolveGeneratedSongPlayableUrl(sourceUrl) {
    const song = this.data.songResult || {};
    if (!sourceUrl) {
      return "";
    }
    if (this.generatedSongTempFilePath && this.generatedSongSourceUrl === sourceUrl) {
      const exists = await readLocalAudioFile(this.generatedSongTempFilePath);
      if (exists) {
        return this.generatedSongTempFilePath;
      }
      this.generatedSongTempFilePath = "";
      this.generatedSongSourceUrl = "";
    }
    if (!USE_CLOUD_CONTAINER) {
      return sourceUrl;
    }
    const tempFilePath = await fetchGeneratedSongTempFileViaCloudContainer(sourceUrl, song);
    this.generatedSongTempFilePath = tempFilePath;
    this.generatedSongSourceUrl = sourceUrl;
    return tempFilePath;
  },

  async handleToggleSongPlay() {
    if (!this.data.songResult || !this.data.songResult.audioUrl) {
      return;
    }
    if (this.data.playingSong && this.audioContext) {
      this.audioContext.stop();
      return;
    }
    try {
      const playableUrl = this.data.savedSongPath || await this.resolveGeneratedSongPlayableUrl(this.data.songResult.audioUrl);
      this.playAudio(playableUrl, "song");
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : "播放失败，请重试",
        icon: "none",
      });
    }
  },

  handleToggleVoiceSample() {
    if (!this.data.songResult || !this.data.songResult.voiceSampleUrl) {
      return;
    }
    if (this.data.playingVoiceSample && this.audioContext) {
      this.audioContext.stop();
      return;
    }
    this.playAudio(this.data.songResult.voiceSampleUrl, "voice");
  },

  async handleSaveSong() {
    if (this.data.savedSongPath) {
      wx.showToast({
        title: "已经保存到本地了",
        icon: "success",
      });
      return;
    }
    const song = this.data.songResult;
    if (!song || !song.audioUrl) {
      return;
    }
    wx.showLoading({
      title: "正在保存",
      mask: true,
    });
    try {
      const playableUrl = await this.resolveGeneratedSongPlayableUrl(song.audioUrl);
      const savedFilePath = await persistAudioToLocalFile(song, playableUrl);
      this.setData({
        savedSongPath: savedFilePath,
      });
      wx.hideLoading();
      wx.showToast({
        title: "音频已保存到本地",
        icon: "success",
      });
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: error && error.message ? error.message : "保存失败，请重试",
        icon: "none",
      });
    }
  },
});
