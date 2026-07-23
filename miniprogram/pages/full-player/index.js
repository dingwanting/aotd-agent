const { trackUserEvent } = require("../../utils/api");
const { normalizeTrack, buildTrackKeyword, ensureFullAudioFile } = require("../../utils/full-audio");

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

    this.trackInfo = normalizeTrack(track);
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

  async prepareFullAudio(autoPlay) {
    this.setData({
      loadingFullAudio: true,
      stateText: autoPlay ? "正在把整首歌接着缓存下来。" : "重新帮你拉一遍完整版，请稍等。",
    });

    try {
      const filePath = await ensureFullAudioFile(this.trackInfo);
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
