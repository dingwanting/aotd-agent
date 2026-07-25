const { STORAGE_KEYS, getStorage } = require("../../utils/storage");
const {
  requestAotdSongGeneration,
  requestVoicePersonaPrepare,
  requestVoicePersonaConfirm,
  trackUserEvent,
} = require("../../utils/api");

const MAX_RECORD_DURATION_MS = 10000;
const MIN_RECORD_DURATION_MS = 2000;

function stripPlaylistPrefix(rawTitle) {
  return String(rawTitle || "").replace(/^AOTD\s*\|\s*/i, "").trim() || "今晚的陪伴";
}

function formatDuration(ms) {
  const totalSeconds = Math.max(1, Math.round((ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

Page({
  data: {
    loading: true,
    errorMessage: "",
    result: null,
    titleText: "",
    recording: false,
    recordingTarget: "",
    recordDurationText: "0:00",
    voiceReady: false,
    voiceTempFilePath: "",
    voiceDurationMs: 0,
    voiceStatusText: "还没有录音，先把主标题读出来。",
    voicePersonaPreparing: false,
    voicePersonaGenerateText: "先生成一条跟读短句",
    voicePersonaTaskId: "",
    voicePersonaValidateText: "",
    voicePersonaId: "",
    voicePersonaReady: false,
    verifyVoiceReady: false,
    verifyVoiceTempFilePath: "",
    verifyVoiceDurationMs: 0,
    verifyRecordDurationText: "0:00",
    verifyVoiceStatusText: "还没有跟读录音，先生成短句再跟读一遍。",
    verifyVoiceGenerating: false,
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
  },

  ensureRecorderManager() {
    if (this.recorderManager || typeof wx.getRecorderManager !== "function") {
      return this.recorderManager;
    }

    const recorderManager = wx.getRecorderManager();
    recorderManager.onStart(() => {
      const recordingTarget = this.recordingTarget || "source";
      this.setData({
        recordingTarget,
      });
      this.recordStartedAt = Date.now();
      if (this.recordingTimer) {
        clearInterval(this.recordingTimer);
      }
      this.recordingTimer = setInterval(() => {
        const durationMs = Date.now() - this.recordStartedAt;
        const durationText = formatDuration(durationMs);
        if (recordingTarget === "verify") {
          this.setData({
            verifyRecordDurationText: durationText,
          });
          return;
        }
        this.setData({
          recordDurationText: durationText,
        });
      }, 250);
      if (recordingTarget === "verify") {
        this.setData({
          recording: true,
          recordingTarget: "verify",
          verifyRecordDurationText: "0:00",
          verifyVoiceStatusText: "正在录音，照着短句自然读出来就好。",
        });
        return;
      }
      this.setData({
        recording: true,
        recordingTarget: "source",
        recordDurationText: "0:00",
        voiceStatusText: "正在录音，把主标题自然地读出来就好。",
      });
    });

    recorderManager.onStop((res) => {
      const recordingTarget = this.recordingTarget || "source";
      this.recordingTarget = "";
      if (this.recordingTimer) {
        clearInterval(this.recordingTimer);
        this.recordingTimer = null;
      }
      const durationMs = Date.now() - (this.recordStartedAt || Date.now());
      const nextDuration = res && typeof res.duration === "number" ? res.duration : durationMs;
      if (recordingTarget === "verify") {
        this.setData({
          recording: false,
          recordingTarget: "",
          verifyVoiceReady: Boolean(res && res.tempFilePath),
          verifyVoiceTempFilePath: res && res.tempFilePath ? res.tempFilePath : "",
          verifyVoiceDurationMs: nextDuration,
          verifyRecordDurationText: formatDuration(nextDuration),
          verifyVoiceStatusText:
            res && res.tempFilePath ? `跟读录好了，时长 ${formatDuration(nextDuration)}` : "跟读录音失败，请再试一次。",
        });
        return;
      }
      this.setData({
        recording: false,
        recordingTarget: "",
        voiceReady: Boolean(res && res.tempFilePath),
        voiceTempFilePath: res && res.tempFilePath ? res.tempFilePath : "",
        voiceDurationMs: nextDuration,
        recordDurationText: formatDuration(nextDuration),
        voiceStatusText: res && res.tempFilePath ? `录好了，时长 ${formatDuration(nextDuration)}` : "录音失败，请再试一次。",
      });
    });

    recorderManager.onError((error) => {
      const recordingTarget = this.recordingTarget || "source";
      this.recordingTarget = "";
      if (this.recordingTimer) {
        clearInterval(this.recordingTimer);
        this.recordingTimer = null;
      }
      if (recordingTarget === "verify") {
        this.setData({
          recording: false,
          recordingTarget: "",
          verifyVoiceStatusText: error && error.errMsg ? error.errMsg : "跟读录音失败，请重试。",
        });
        return;
      }
      this.setData({
        recording: false,
        recordingTarget: "",
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
      this.recordingTarget = "source";
      recorderManager.start({
        duration: MAX_RECORD_DURATION_MS,
        format: "mp3",
        numberOfChannels: 1,
        sampleRate: 44100,
        encodeBitRate: 96000,
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

  async handleStartVerifyRecord() {
    if (this.data.recording || !this.data.voicePersonaValidateText) {
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
      this.recordingTarget = "verify";
      recorderManager.start({
        duration: MAX_RECORD_DURATION_MS,
        format: "mp3",
        numberOfChannels: 1,
        sampleRate: 44100,
        encodeBitRate: 96000,
      });
    } catch (error) {
      wx.showToast({
        title: "需要录音权限",
        icon: "none",
      });
    }
  },

  handleClearVoice() {
    this.setData({
      voiceReady: false,
      voiceTempFilePath: "",
      voiceDurationMs: 0,
      recordDurationText: "0:00",
      recordingTarget: "",
      voiceStatusText: "已清空，重新录一遍吧。",
      voicePersonaPreparing: false,
      voicePersonaGenerateText: "先生成一条跟读短句",
      voicePersonaTaskId: "",
      voicePersonaValidateText: "",
      voicePersonaId: "",
      voicePersonaReady: false,
      verifyVoiceReady: false,
      verifyVoiceTempFilePath: "",
      verifyVoiceDurationMs: 0,
      verifyRecordDurationText: "0:00",
      verifyVoiceStatusText: "还没有跟读录音，先生成短句再跟读一遍。",
      verifyVoiceGenerating: false,
      songResult: null,
      songMetaText: "",
      generationNote: "",
      savedSongPath: "",
      playingSong: false,
      playingVoiceSample: false,
    });
  },

  handleClearVerifyVoice() {
    this.setData({
      verifyVoiceReady: false,
      verifyVoiceTempFilePath: "",
      verifyVoiceDurationMs: 0,
      verifyRecordDurationText: "0:00",
      recordingTarget: "",
      verifyVoiceStatusText: "已清空，重新跟读一遍吧。",
      voicePersonaId: "",
      voicePersonaReady: false,
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

  async handlePrepareVoicePersona() {
    const titleText = String(this.data.titleText || "").trim();
    if (!titleText) {
      wx.showToast({
        title: "先输入主标题",
        icon: "none",
      });
      return;
    }
    if (!this.data.voiceReady || !this.data.voiceTempFilePath) {
      wx.showToast({
        title: "先录一段标题语音",
        icon: "none",
      });
      return;
    }
    if (this.data.voiceDurationMs < MIN_RECORD_DURATION_MS) {
      wx.showToast({
        title: "语音太短了，至少录 2 秒",
        icon: "none",
      });
      return;
    }
    this.setData({
      voicePersonaPreparing: true,
      voicePersonaGenerateText: "正在生成跟读短句...",
    });
    try {
      const voiceBase64 = await this.readVoiceBase64(this.data.voiceTempFilePath);
      const voicePersona = await requestVoicePersonaPrepare({
        titleText,
        voiceBase64,
        voiceFormat: "mp3",
        voiceDurationMs: this.data.voiceDurationMs,
      });
      this.setData({
        voicePersonaPreparing: false,
        voicePersonaGenerateText: "重新生成一条短句",
        voicePersonaTaskId: voicePersona.taskId,
        voicePersonaValidateText: voicePersona.validateInfo,
        verifyVoiceStatusText: "短句已经准备好了，照着读一遍吧。",
        voicePersonaId: "",
        voicePersonaReady: false,
        verifyVoiceReady: false,
        verifyVoiceTempFilePath: "",
        verifyVoiceDurationMs: 0,
        verifyRecordDurationText: "0:00",
      });
    } catch (error) {
      this.setData({
        voicePersonaPreparing: false,
        voicePersonaGenerateText: "先生成一条跟读短句",
      });
      wx.showToast({
        title: error && error.message ? error.message : "生成短句失败，请稍后再试",
        icon: "none",
      });
    }
  },

  async handleGenerateVoicePersona() {
    const titleText = String(this.data.titleText || "").trim();
    if (!this.data.voicePersonaTaskId || !this.data.voicePersonaValidateText) {
      wx.showToast({
        title: "先生成跟读短句",
        icon: "none",
      });
      return;
    }
    if (!this.data.verifyVoiceReady || !this.data.verifyVoiceTempFilePath) {
      wx.showToast({
        title: "先录一遍跟读短句",
        icon: "none",
      });
      return;
    }
    if (this.data.verifyVoiceDurationMs < MIN_RECORD_DURATION_MS) {
      wx.showToast({
        title: "跟读录音太短了",
        icon: "none",
      });
      return;
    }
    this.setData({
      verifyVoiceGenerating: true,
      verifyVoiceStatusText: "正在生成你的专属音色...",
    });
    try {
      const verifyVoiceBase64 = await this.readVoiceBase64(this.data.verifyVoiceTempFilePath);
      const voicePersona = await requestVoicePersonaConfirm({
        validateTaskId: this.data.voicePersonaTaskId,
        titleText: titleText || "我的 AOTD",
        verifyVoiceBase64,
        verifyVoiceFormat: "mp3",
      });
      this.setData({
        verifyVoiceGenerating: false,
        voicePersonaId: voicePersona.voiceId,
        voicePersonaReady: true,
        verifyVoiceStatusText: voicePersona.isAvailable ? "你的音色已经准备好了，可以拿去出歌。" : "音色已经生成，稍后会继续生效。",
      });
    } catch (error) {
      this.setData({
        verifyVoiceGenerating: false,
        verifyVoiceStatusText: "生成音色失败，请再试一次。",
      });
      wx.showToast({
        title: error && error.message ? error.message : "生成音色失败，请稍后再试",
        icon: "none",
      });
    }
  },

  async handleGenerateSong() {
    const result = this.data.result;
    const titleText = String(this.data.titleText || "").trim();
    if (!titleText) {
      wx.showToast({
        title: "先输入主标题",
        icon: "none",
      });
      return;
    }
    if (!this.data.voiceReady || !this.data.voiceTempFilePath) {
      wx.showToast({
        title: "先录一段标题语音",
        icon: "none",
      });
      return;
    }
    if (this.data.voiceDurationMs < MIN_RECORD_DURATION_MS) {
      wx.showToast({
        title: "语音太短了，至少录 2 秒",
        icon: "none",
      });
      return;
    }

    this.setData({
      generating: true,
      generationText: "正在整理你的录音和歌单气质...",
    });

    try {
      const voiceBase64 = await this.readVoiceBase64(this.data.voiceTempFilePath);
      this.setData({
        generationText: "正在生成专属 AOTD 小歌...",
      });
      const payload = await requestAotdSongGeneration({
        titleText,
        playlistTitle: result.playlist.title,
        answers: result.answers,
        tracks: result.playlist.tracks.map((track) => ({
          title: track.song && track.song.title ? track.song.title : "",
          artist: track.song && track.song.artist ? track.song.artist : "",
        })),
        voiceBase64,
        voiceFormat: "mp3",
        voiceDurationMs: this.data.voiceDurationMs,
        voicePersonaId: this.data.voicePersonaId || "",
      });
      const song = payload.song || {};
      this.setData({
        generating: false,
        generationText: "正在为你制作...",
        songResult: song,
        songMetaText: `${Math.round(song.durationSeconds || 0)} 秒 · ${song.mode === "demo" ? "Demo 音轨" : "专属歌曲"}`,
        generationNote:
          (this.data.voicePersonaReady ? "这次会优先使用你刚生成的专属音色。" : "") +
          (payload.meta && payload.meta.note ? payload.meta.note : ""),
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

  handleToggleSongPlay() {
    if (!this.data.songResult || !this.data.songResult.audioUrl) {
      return;
    }
    if (this.data.playingSong && this.audioContext) {
      this.audioContext.stop();
      return;
    }
    this.playAudio(this.data.savedSongPath || this.data.songResult.audioUrl, "song");
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
      const download = await new Promise((resolve, reject) => {
        wx.downloadFile({
          url: song.audioUrl,
          success: resolve,
          fail: reject,
        });
      });
      const tempFilePath = download && (download.tempFilePath || download.filePath);
      if (!tempFilePath) {
        throw new Error("没有拿到可保存的音频文件");
      }
      const saved = await new Promise((resolve, reject) => {
        wx.saveFile({
          tempFilePath,
          success: resolve,
          fail: reject,
        });
      });
      this.setData({
        savedSongPath: saved && saved.savedFilePath ? saved.savedFilePath : tempFilePath,
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
