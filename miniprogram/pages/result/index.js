const { STORAGE_KEYS, getStorage, clearAnswers, clearQuestionDeck, clearResult } = require("../../utils/storage");
const { requestRecommendation, loadResultIfMatched } = require("../../utils/api");
const { API_BASE_URL } = require("../../utils/config");

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

function buildPlaylistCopyText(result) {
  const tracks = result && result.playlist && result.playlist.tracks ? result.playlist.tracks : [];
  const title = result && result.playlist ? result.playlist.title : "今晚歌单";
  const lines = [`${title}`, ""];
  tracks.forEach((track, index) => {
    const song = track.song || {};
    lines.push(`${index + 1}. ${song.title || ""} - ${song.artist || ""}`);
  });
  lines.push("", "复制后可直接到网易云音乐粘贴搜索。");
  return lines.join("\n");
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

Page({
  data: {
    loading: true,
    errorMessage: "",
    result: null,
    copiedTrackIndex: -1,
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

  handleCopyPlaylist() {
    const result = this.data.result;
    if (!result || !result.playlist || !result.playlist.tracks || !result.playlist.tracks.length) {
      return;
    }

    wx.setClipboardData({
      data: buildPlaylistCopyText(result),
      success: () => {
        wx.showModal({
          title: "整单已复制",
          content: "已复制今晚歌单。你可以直接粘贴到网易云音乐、聊天或备忘录里继续使用。",
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
        content: "这首歌暂时没有拿到可播放音频流，你可以先复制到网易云继续听。",
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
    audioContext.src = buildAudioStreamUrl(track);
  }
});
