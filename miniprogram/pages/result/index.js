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
const POSTER_CANVAS_ID = "aotdPosterCanvas";
const POSTER_WIDTH = 720;
const POSTER_HEIGHT = 1080;
const POSTER_SCALE = POSTER_WIDTH / 1080;

function normalizeCoverTitle(rawTitle) {
  const title = String(rawTitle || "").trim();
  return title || "AOTD|今晚的歌单已经备好";
}

function applyCoverTitle(result) {
  if (!result || !result.playlist) {
    return result;
  }
  return Object.assign({}, result, {
    playlist: Object.assign({}, result.playlist, {
      title: normalizeCoverTitle(result.playlist.title),
    }),
  });
}

function isFallbackNickname(nickname) {
  return !nickname || nickname === FALLBACK_NICKNAME;
}

function stripPlaylistPrefix(rawTitle) {
  return String(rawTitle || "").replace(/^AOTD\s*\|\s*/i, "").trim() || "今晚的歌单";
}

function withPromise(api, options) {
  return new Promise((resolve, reject) => {
    api(
      Object.assign({}, options, {
        success: resolve,
        fail: reject,
      }),
    );
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPosterShortCopy(result) {
  const shareCard = result && result.shareCard ? result.shareCard : null;
  const tags = shareCard && Array.isArray(shareCard.tags) ? shareCard.tags.filter(Boolean) : [];
  const fromState = tags[0] || "今天这会儿";
  const toNeed = tags[1] || "缓一缓";
  const scene = tags[2] || "今晚";
  return {
    kicker: `${fromState}的时候，今天先听这个。`,
    subline: `想${toNeed}一点，就放在${scene}里听。`,
  };
}

function wrapPosterText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const content = String(text || "").trim();
  if (!content) {
    return y;
  }

  let line = "";
  let row = 0;
  const chars = content.split("");
  for (let index = 0; index < chars.length; index += 1) {
    const testLine = line + chars[index];
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && line) {
      row += 1;
      const nextLine = row >= maxLines ? `${line.slice(0, Math.max(0, line.length - 1))}…` : line;
      ctx.fillText(nextLine, x, y + lineHeight * (row - 1));
      line = chars[index];
      if (row >= maxLines) {
        return y + lineHeight * row;
      }
    } else {
      line = testLine;
    }
  }

  if (line) {
    row += 1;
    ctx.fillText(line, x, y + lineHeight * (row - 1));
  }
  return y + lineHeight * row;
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

function buildNeteasePlayPageUrl(track) {
  const song = track && track.song ? track.song : {};
  const params = [];
  const keyword = buildTrackKeyword(track);

  if (song.originalId) {
    params.push(`originalId=${encodeURIComponent(String(song.originalId))}`);
  }
  if (song.title) {
    params.push(`title=${encodeURIComponent(song.title)}`);
  }
  if (song.artist) {
    params.push(`artist=${encodeURIComponent(song.artist)}`);
  }
  if (keyword) {
    params.push(`keyword=${encodeURIComponent(keyword)}`);
  }

  return `${API_BASE_URL}/netease-player.html?${params.join("&")}`;
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
    profileNickname: FALLBACK_NICKNAME,
    profileAvatarUrl: "",
    profileAvatarFileId: "",
    copiedTrackIndex: -1,
    supportsInlineAudio: SUPPORT_INLINE_AUDIO,
    playingTrackIndex: -1,
    loadingTrackIndex: -1,
    audioRetryCount: 0,
    showNicknameAuth: false,
    posterGenerating: false,
    posterReady: false,
    posterImagePath: "",
    showPosterPreview: false
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
    const avatarFileId = getStorage(STORAGE_KEYS.avatarFileId, "");
    const avatarUrl = getStorage(STORAGE_KEYS.avatarUrl, "") || avatarFileId;

    const cached = loadResultIfMatched(answers);
    if (cached) {
      this.setData({
        loading: false,
        errorMessage: "",
        result: applyCoverTitle(cached),
        profileNickname: nickname,
        profileAvatarUrl: avatarUrl,
        profileAvatarFileId: avatarFileId,
        copiedTrackIndex: -1,
        playingTrackIndex: -1,
        loadingTrackIndex: -1,
        showNicknameAuth: isFallbackNickname(nickname),
        posterReady: false,
        posterImagePath: "",
        showPosterPreview: false
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
        result: applyCoverTitle(result),
        profileNickname: nickname,
        profileAvatarUrl: avatarUrl,
        profileAvatarFileId: avatarFileId,
        copiedTrackIndex: -1,
        playingTrackIndex: -1,
        loadingTrackIndex: -1,
        showNicknameAuth: isFallbackNickname(nickname),
        posterReady: false,
        posterImagePath: "",
        showPosterPreview: false
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

  noop() {},

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

  handleOpenNeteaseTrack(event) {
    const { index } = event.currentTarget.dataset;
    const result = this.data.result;
    const track = result && result.playlist && result.playlist.tracks ? result.playlist.tracks[index] : null;
    if (!track) {
      return;
    }

    const playerUrl = buildNeteasePlayPageUrl(track);
    this.setData({
      copiedTrackIndex: Number(index)
    });
    trackUserEvent({
      type: "track_open_netease_h5",
      trackRank: track.rank,
      title: track.song && track.song.title,
      artist: track.song && track.song.artist,
      originalId: track.song && track.song.originalId ? String(track.song.originalId) : ""
    }).catch(() => {});
    wx.navigateTo({
      url: `/pages/player-webview/index?src=${encodeURIComponent(playerUrl)}&title=${encodeURIComponent(track.song && track.song.title ? track.song.title : "网易云播放页")}`
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
        result: applyCoverTitle(current)
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

  buildPosterCacheKey() {
    const result = this.data.result;
    const tracks = result && result.playlist && Array.isArray(result.playlist.tracks) ? result.playlist.tracks : [];
    return JSON.stringify({
      title: result && result.playlist ? result.playlist.title : "",
      subtitle: result && result.playlist ? result.playlist.subtitle : "",
      tracks: tracks.map((track) => ({
        rank: track.rank,
        title: track.song && track.song.title,
        artist: track.song && track.song.artist,
      })),
      nickname: this.data.profileNickname,
      avatar: this.data.profileAvatarFileId || this.data.profileAvatarUrl || "",
    });
  },

  async ensurePosterCanvas() {
    if (this.posterCanvas && this.posterCtx) {
      return {
        canvas: this.posterCanvas,
        ctx: this.posterCtx,
      };
    }

    return new Promise((resolve, reject) => {
      wx.createSelectorQuery()
        .in(this)
        .select(`#${POSTER_CANVAS_ID}`)
        .fields({ node: true, size: true })
        .exec((res) => {
          const target = res && res[0];
          if (!target || !target.node) {
            reject(new Error("报告画布初始化失败"));
            return;
          }

          const canvas = target.node;
          const ctx = canvas.getContext("2d");
          const systemInfo = wx.getSystemInfoSync ? wx.getSystemInfoSync() : { pixelRatio: 1 };
          const dpr = Math.max(1, Number(systemInfo.pixelRatio) || 1);
          canvas.width = Math.max(1, Math.floor(target.width * dpr));
          canvas.height = Math.max(1, Math.floor(target.height * dpr));
          ctx.scale(dpr, dpr);
          this.posterCanvas = canvas;
          this.posterCtx = ctx;
          this.posterDpr = dpr;
          resolve({ canvas, ctx });
        });
    });
  },

  async resolvePosterAvatarPath() {
    const avatarSource = this.data.profileAvatarFileId || this.data.profileAvatarUrl;
    if (!avatarSource) {
      return "";
    }
    if (avatarSource.indexOf("cloud://") === 0) {
      if (!wx.cloud || typeof wx.cloud.downloadFile !== "function") {
        return "";
      }
      const downloaded = await withPromise(wx.cloud.downloadFile.bind(wx.cloud), {
        fileID: avatarSource,
      });
      return downloaded && downloaded.tempFilePath ? downloaded.tempFilePath : "";
    }
    if (
      avatarSource.indexOf("wxfile://") === 0 ||
      avatarSource.indexOf(wx.env.USER_DATA_PATH) === 0 ||
      avatarSource.indexOf("http://tmp/") === 0
    ) {
      return avatarSource;
    }
    const imageInfo = await withPromise(wx.getImageInfo, {
      src: avatarSource,
    });
    return imageInfo && imageInfo.path ? imageInfo.path : "";
  },

  async canvasToPosterFilePath(retryCount) {
    const canvas = this.posterCanvas;
    if (!canvas) {
      throw new Error("报告画布尚未准备好");
    }
    const attemptTotal = retryCount || 3;
    let lastError = null;

    for (let attempt = 0; attempt < attemptTotal; attempt += 1) {
      try {
        await wait(120 + attempt * 120);
        const file = await withPromise(wx.canvasToTempFilePath, {
          canvas,
          x: 0,
          y: 0,
          width: canvas.width,
          height: canvas.height,
          destWidth: canvas.width,
          destHeight: canvas.height,
          fileType: "png",
          quality: 1,
        });
        if (file && file.tempFilePath) {
          return file.tempFilePath;
        }
      } catch (error) {
        lastError = error;
        console.error("[aotd] poster export failed", {
          attempt: attempt + 1,
          errMsg: error && error.errMsg ? error.errMsg : "",
          message: error && error.message ? error.message : "",
        });
      }
    }

    throw lastError || new Error("报告图导出失败");
  },

  async loadCanvasImage(canvas, src) {
    if (!canvas || !src) {
      return null;
    }
    return new Promise((resolve, reject) => {
      const image = canvas.createImage();
      image.onload = () => resolve(image);
      image.onerror = (error) => reject(error || new Error("图片加载失败"));
      image.src = src;
    });
  },

  drawPoster(ctx, poster) {
    const scale = POSTER_SCALE;
    const sx = (value) => value * scale;
    const sy = (value) => value * scale;
    const title = stripPlaylistPrefix(poster.result.playlist.title);
    const posterCopy = buildPosterShortCopy(poster.result);

    ctx.clearRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
    const bgGradient = ctx.createLinearGradient(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
    bgGradient.addColorStop(0, "#fff8fb");
    bgGradient.addColorStop(0.45, "#f8e8ef");
    bgGradient.addColorStop(1, "#f1d6e1");
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

    const halo = ctx.createRadialGradient(sx(220), sy(200), sx(40), sx(220), sy(200), sx(460));
    halo.addColorStop(0, "rgba(255,255,255,0.92)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillRect(sx(78), sy(72), POSTER_WIDTH - sx(156), POSTER_HEIGHT - sy(144));

    ctx.fillStyle = "#b86b88";
    ctx.font = `${Math.round(sx(24))}px sans-serif`;
    ctx.fillText("AOTD", sx(120), sy(150));

    ctx.fillStyle = "#5c3f4b";
    ctx.font = `${Math.round(sx(72))}px sans-serif`;
    const nextY = wrapPosterText(ctx, title, sx(120), sy(246), POSTER_WIDTH - sx(240), sy(84), 2);

    ctx.fillStyle = "rgba(92,63,75,0.72)";
    ctx.font = `${Math.round(sx(28))}px sans-serif`;
    wrapPosterText(
      ctx,
      posterCopy.kicker,
      sx(120),
      nextY + sy(26),
      POSTER_WIDTH - sx(240),
      sy(42),
      2,
    );
    wrapPosterText(
      ctx,
      posterCopy.subline,
      sx(120),
      nextY + sy(94),
      POSTER_WIDTH - sx(240),
      sy(38),
      2,
    );

    const recordCenterX = sx(330);
    const recordCenterY = sy(800);
    const recordRadius = sx(220);
    const recordGradient = ctx.createLinearGradient(sx(110), sy(580), sx(550), sy(1020));
    recordGradient.addColorStop(0, "#2d2930");
    recordGradient.addColorStop(1, "#111015");
    ctx.fillStyle = recordGradient;
    ctx.beginPath();
    ctx.arc(recordCenterX, recordCenterY, recordRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = Math.max(1, sx(2));
    for (let ring = 0; ring < 7; ring += 1) {
      ctx.beginPath();
      ctx.arc(recordCenterX, recordCenterY, sx(60 + ring * 22), 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = "#f5d6e1";
    ctx.beginPath();
    ctx.arc(recordCenterX, recordCenterY, sx(88), 0, Math.PI * 2);
    ctx.fill();

    if (poster.avatarImage) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(recordCenterX, recordCenterY, sx(52), 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(poster.avatarImage, recordCenterX - sx(52), recordCenterY - sx(52), sx(104), sx(104));
      ctx.restore();
    } else {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(recordCenterX, recordCenterY, sx(28), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = Math.max(1, sx(3));
    ctx.beginPath();
    ctx.moveTo(sx(460), sy(660));
    ctx.lineTo(sx(710), sy(560));
    ctx.lineTo(sx(758), sy(614));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(sx(742), sy(620), sx(34), 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "#5c3f4b";
    ctx.font = `${Math.round(sx(30))}px sans-serif`;
    ctx.fillText("Track List", sx(560), sy(690));
    ctx.font = `${Math.round(sx(26))}px sans-serif`;
    ctx.fillStyle = "rgba(92,63,75,0.72)";
    ctx.fillText("今晚唱片里的 5 首歌", sx(560), sy(730));

    poster.result.playlist.tracks.slice(0, 5).forEach((track, index) => {
      const top = sy(790 + index * 128);
      ctx.fillStyle = "rgba(255,255,255,0.68)";
      ctx.fillRect(sx(540), top - sy(34), sx(380), sy(92));
      ctx.fillStyle = "#b86b88";
      ctx.font = `${Math.round(sx(24))}px sans-serif`;
      ctx.fillText(`0${index + 1}`.slice(-2), sx(568), top);
      ctx.fillStyle = "#4f3943";
      ctx.font = `${Math.round(sx(30))}px sans-serif`;
      const songTitle = track.song && track.song.title ? track.song.title : "未知曲目";
      wrapPosterText(ctx, songTitle, sx(620), top - sy(8), sx(270), sy(34), 1);
      ctx.fillStyle = "rgba(79,57,67,0.72)";
      ctx.font = `${Math.round(sx(22))}px sans-serif`;
      const artist = track.song && track.song.artist ? track.song.artist : "";
      wrapPosterText(ctx, artist, sx(620), top + sy(28), sx(250), sy(30), 1);
    });
  },

  async ensurePosterImage() {
    const result = this.data.result;
    if (!result || !result.playlist || !Array.isArray(result.playlist.tracks) || !result.playlist.tracks.length) {
      throw new Error("还没有可生成的歌单");
    }

    const posterCacheKey = this.buildPosterCacheKey();
    if (this.data.posterReady && this.data.posterImagePath && this.posterCacheKey === posterCacheKey) {
      return this.data.posterImagePath;
    }

    if (this.posterPromise) {
      return this.posterPromise;
    }

    this.posterPromise = (async () => {
      this.setData({
        posterGenerating: true,
      });
      wx.showLoading({
        title: "正在生成报告",
        mask: true,
      });

      const posterCanvas = await this.ensurePosterCanvas();
      const ctx = posterCanvas.ctx;
      const avatarPath = await this.resolvePosterAvatarPath().catch(() => "");
      const avatarImage = avatarPath
        ? await this.loadCanvasImage(posterCanvas.canvas, avatarPath).catch((error) => {
            console.warn("[aotd] poster avatar load failed", {
              errMsg: error && error.errMsg ? error.errMsg : "",
              message: error && error.message ? error.message : "",
            });
            return null;
          })
        : null;
      this.drawPoster(ctx, {
        result,
        nickname: this.data.profileNickname,
        avatarImage,
      });
      const imagePath = await this.canvasToPosterFilePath(3);
      this.posterCacheKey = posterCacheKey;
      this.setData({
        posterGenerating: false,
        posterReady: Boolean(imagePath),
        posterImagePath: imagePath,
      });
      wx.hideLoading();
      trackUserEvent({
        type: "poster_generated",
        title: result.playlist.title,
      }).catch(() => {});
      return imagePath;
    })()
      .catch((error) => {
        console.error("[aotd] poster generation failed", {
          errMsg: error && error.errMsg ? error.errMsg : "",
          message: error && error.message ? error.message : "",
        });
        this.setData({
          posterGenerating: false,
        });
        wx.hideLoading();
        throw error;
      })
      .finally(() => {
        this.posterPromise = null;
      });

    return this.posterPromise;
  },

  async handleGeneratePoster() {
    try {
      const posterPath = await this.ensurePosterImage();
      if (!posterPath) {
        throw new Error("报告图生成失败");
      }
      this.setData({
        showPosterPreview: true,
      });
      trackUserEvent({
        type: "poster_preview_opened",
      }).catch(() => {});
    } catch (error) {
      const message = error && error.errMsg ? error.errMsg : error && error.message ? error.message : "";
      wx.showModal({
        title: "报告图生成失败",
        content: message || "请重试一次，如果仍失败我再继续修这一条链路。",
        showCancel: false,
      });
    }
  },

  handleClosePosterPreview() {
    this.setData({
      showPosterPreview: false,
    });
  },

  async handleSavePoster() {
    try {
      const posterPath = this.data.posterImagePath || (await this.ensurePosterImage());
      if (!posterPath) {
        throw new Error("报告图生成失败");
      }
      await withPromise(wx.saveImageToPhotosAlbum, {
        filePath: posterPath,
      });
      trackUserEvent({
        type: "poster_saved",
      }).catch(() => {});
      wx.showToast({
        title: "已保存到相册",
        icon: "success",
      });
    } catch (error) {
      const message = error && error.errMsg ? error.errMsg : error && error.message ? error.message : "";
      if (message.indexOf("auth") >= 0 || message.indexOf("deny") >= 0) {
        wx.showModal({
          title: "需要相册权限",
          content: "请允许保存到相册后，再次生成 AOTD 报告。",
          confirmText: "去开启",
          success: (modalRes) => {
            if (modalRes.confirm) {
              wx.openSetting({});
            }
          },
        });
        return;
      }
      wx.showModal({
        title: "保存报告失败",
        content: message || "请重试一次，如果仍失败我再继续修这一条链路。",
        showCancel: false,
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
        content: `这首歌暂时没有稳定拿到可播放音频流${formatAudioErrorCode(error)}，你可以点“去网易云听”继续打开播放页。`,
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
            content: "试听启动超时，已自动中断本次缓冲。你可以重试，或点“去网易云听”继续打开播放页。",
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
            : "这首歌暂时没有拿到可播放音频流，你可以点“去网易云听”继续打开播放页。",
          showCancel: false
        });
      });
  }
});
