const {
  STORAGE_KEYS,
  getStorage,
  setStorage,
  clearSongCreationState,
  clearAnswers,
  clearQuestionDeck,
  clearResult,
} = require("../../utils/storage");
const {
  requestRecommendation,
  loadResultIfMatched,
  updateUserProfile,
  trackUserEvent,
  requestEveningReminderStatus,
  createEveningReminder,
  createAotdSongTask,
  waitForAotdSongTask,
} = require("../../utils/api");
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
const POSTER_TEMPLATE_PATH = "/assets/poster/aotd-report-template.jpg";
const POSTER_QRCODE_PATH = "/assets/poster/aotd-mini-qrcode.png";
const DEFAULT_SHARE_IMAGE = "/assets/landing/hero-entry-final.jpg";
const POSTER_TEMPLATE_WIDTH = 1020;
const POSTER_TEMPLATE_HEIGHT = 1541;
const EVENING_REMINDER_TEMPLATE_ID = "juig4kKFh82FrsxB-gjvpIgNqn3fZgCEB2duDNCuLjY";
const REPORT_ENTRY_EMOJIS = ["✨", "💗", "🎧", "🌙", "🫧", "🎼"];
const RESULT_TABS = {
  PLAYLIST: "playlist",
  MY_AOTD: "my-aotd",
};
const MAX_SONG_TITLE_LENGTH = 20;
const VOCAL_OPTIONS = [
  { value: "male", label: "男声", description: "更温暖、更成熟，像夜里靠近耳边的低声陪伴。" },
  { value: "female", label: "女声", description: "更细腻、更柔和，像晚风里轻轻唱给你的版本。" },
  { value: "child", label: "儿童音", description: "更清亮、更纯净，像带一点天真感的轻声安慰。" },
  { value: "foreign", label: "外国人", description: "更偏海外流行唱腔，可以带一点英文 hook 和异国感。" },
];
const GENERATION_PROGRESS_STEPS = [
  { label: "选人声", text: "正在确认你想要的人声方向...", progress: 16 },
  { label: "理气质", text: "正在整理今晚歌单的氛围和曲风...", progress: 34 },
  { label: "写旋律", text: "正在把标题写进主旋律里...", progress: 56 },
  { label: "做编曲", text: "正在给这首歌铺底色和和声...", progress: 74 },
  { label: "出音频", text: "正在输出最终音频和人声细节...", progress: 92 },
];
const GENERATION_PROGRESS_HOLD_TEXTS = [
  "正在把旋律和编曲继续合成在一起...",
  "正在细修人声和氛围层次...",
  "正在导出最终音频，再等一下就好...",
];
const SONG_CREATION_RESUME_WINDOW_MS = 90 * 60 * 1000;
const SONG_CREATION_CONTINUE_MESSAGE = "这首小歌还在继续生成，先去忙一会儿，稍后回来会自动接着查结果";

function formatReminderDateText(remindAt) {
  if (!remindAt) {
    return "明天";
  }
  return `${remindAt.getMonth() + 1}月${remindAt.getDate()}日`;
}

function isSongGenerationStillRunningMessage(message) {
  const text = String(message || "");
  return /还在继续生成|稍后回来|真实音乐服务生成超时/.test(text);
}

function pickReportEntryCtaText() {
  const emoji = REPORT_ENTRY_EMOJIS[Math.floor(Math.random() * REPORT_ENTRY_EMOJIS.length)] || "✨";
  return `去生成 ${emoji}`;
}

function normalizeCoverTitle(rawTitle) {
  const title = String(rawTitle || "").trim();
  return title || "AOTD|今晚的歌单已经备好";
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

function findVocalOption(value) {
  return VOCAL_OPTIONS.find((item) => item.value === value) || null;
}

function buildVocalProfileLabel(value) {
  const option = findVocalOption(value);
  return option ? option.label : "默认人声";
}

function buildSongMetaText(song, vocalLabel) {
  return `${vocalLabel} · ${song && song.mode === "demo" ? "Demo 音轨" : "专属歌曲"}`;
}

function buildStylePreviewFromAnswers(answers) {
  const sourceText = String(answers && answers.consumptionSource ? answers.consumptionSource : "");
  const needText = String(answers && answers.emotionalNeed ? answers.emotionalNeed : "");
  const imageryText = String(answers && answers.emotionalImagery ? answers.emotionalImagery : "");
  const profiles = [
    {
      label: "下班治愈",
      styleName: "Evening R&B",
      score:
        (/下班|通勤|开会|加班|工作|疲惫|很累|消耗|掏空|透支/.test(sourceText) ? 2 : 0) +
        (/放松|治愈|抱抱|陪伴|缓一缓|休息|被接住|慢下来|松一点|轻一点/.test(needText) ? 4 : 0) +
        (/晚风|路灯|回家|散步|夜路|耳机|街边/.test(imageryText) ? 2 : 0),
      reason:
        `更贴近你现在想要的“${needText || "放松一下"}”，画面也更像“${imageryText || "晚风回家路"}”这种下班后被轻轻接住的感觉。`,
    },
    {
      label: "城市夜晚",
      styleName: "City Pop / Electronic R&B",
      score:
        (/通勤|地铁|公交|路上|城市/.test(sourceText) ? 1 : 0) +
        (/放空|散步|走一走|夜游|吹风/.test(needText) ? 2 : 0) +
        (/霓虹|地铁|车窗|高架|街灯|城市|夜色|夜晚|街口|隧道/.test(imageryText) ? 4 : 0),
      reason:
        `这组答案更容易长成“${imageryText || "城市夜路"}”这种夜行画面，所以会更偏城市夜晚的霓虹和地铁感。`,
    },
    {
      label: "重新充电",
      styleName: "Modern Indie Pop",
      score:
        (/消耗|疲惫|低电量|没电|透支|筋疲力尽/.test(sourceText) ? 1 : 0) +
        (/重新开始|重启|充电|恢复|缓过来|找回节奏|明天|调整状态|稳定|继续往前/.test(needText) ? 4 : 0) +
        (/清晨|窗边|台阶|明天|起点/.test(imageryText) ? 1 : 0),
      reason:
        `你现在更像是在找“${needText || "重新充电"}”这种 quiet confidence，所以会优先往重新充电这档靠。`,
    },
    {
      label: "深夜独处",
      styleName: "Minimal Piano Jazz Ballad",
      score:
        (/想太多|信息过载|内耗|情绪很多|睡不着/.test(sourceText) ? 1 : 0) +
        (/想清楚|清空大脑|安静|独处|自己待会|思考|消化一下/.test(needText) ? 3 : 0) +
        (/深夜|咖啡店|窗边|雨夜|房间|桌灯|一个人|夜深/.test(imageryText) ? 4 : 0),
      reason:
        `因为你给出的画面更像“${imageryText || "深夜窗边"}”，系统会更倾向深夜独处这档极简、低声的走法。`,
    },
    {
      label: "快乐奖励",
      styleName: "K-pop / Funk Pop",
      score:
        (/周五|终于下班|忙完|辛苦一天/.test(sourceText) ? 1 : 0) +
        (/开心|奖励|庆祝|自由|放肆|开心一下|玩一下|轻快/.test(needText) ? 4 : 0) +
        (/晚霞|落日|周五|傍晚|街角|自由|sunset/.test(imageryText) ? 3 : 0),
      reason:
        `这组答案里有明显的“${needText || "快乐奖励"}”信号，所以会更偏周五傍晚那种轻快小奖励。`,
    },
  ].sort((left, right) => right.score - left.score);
  const matched = profiles[0] && profiles[0].score > 0 ? profiles[0] : profiles[1] || profiles[0];
  return matched
    ? {
        label: matched.label,
        styleName: matched.styleName,
        summary: `${matched.label} · ${matched.styleName}`,
        reason: matched.reason,
      }
    : {
        label: "下班治愈",
        styleName: "Evening R&B",
        summary: "下班治愈 · Evening R&B",
        reason: "默认先按下班后放松、被轻轻接住的方向来预估这首小歌。",
      };
}

function buildSongCreationState(playlistTitle, answers) {
  const stylePreview = buildStylePreviewFromAnswers(answers);
  return {
    titleText: stripPlaylistPrefix(playlistTitle || "").slice(0, MAX_SONG_TITLE_LENGTH),
    titleMaxLength: MAX_SONG_TITLE_LENGTH,
    vocalOptions: VOCAL_OPTIONS,
    stylePreview,
    selectedVocalProfile: "",
    generatingSong: false,
    generationText: "正在为你制作...",
    showGenerationProgress: false,
    generationProgressSteps: GENERATION_PROGRESS_STEPS,
    generationProgressStepIndex: -1,
    generationProgressPercent: 0,
    generationProgressText: "",
    songResult: null,
    songMetaText: "",
    generationNote: "",
    savedSongPath: "",
    playingSong: false,
    loadingSong: false,
  };
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

function buildPosterOwnerLine(nickname) {
  const name = String(nickname || "").trim();
  return name ? `${name} 的 AOTD` : "你的 AOTD";
}

function getAnswers() {
  return getStorage(STORAGE_KEYS.answers, {});
}

function buildSongCreationSignature(result, answers) {
  const playlistTitle = result && result.playlist ? String(result.playlist.title || "") : "";
  const normalizedAnswers = answers || {};
  return JSON.stringify({
    playlistTitle,
    consumptionSource: normalizedAnswers.consumptionSource || "",
    emotionalNeed: normalizedAnswers.emotionalNeed || "",
    emotionalImagery: normalizedAnswers.emotionalImagery || "",
  });
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

function isCloudInvalidHostError(error) {
  const message =
    error && error.errMsg
      ? String(error.errMsg)
      : error && error.message
        ? String(error.message)
        : "";
  return /invalid[_\s-]*host|docs\.cloudbase\.net\/error-code\/service\/INVALID_HOST/i.test(message);
}

function buildFriendlyPlaylistPlaybackMessage() {
  return "你的AOTD歌单暂时无法播放，请稍后重试。";
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

          if (isCloudInvalidHostError(error)) {
            resolve(buildAudioStreamUrl(track));
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

          if (isCloudInvalidHostError(error)) {
            resolve(buildAudioStreamUrl(track));
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
          env: CLOUD_ENV_ID
        },
        path,
        method: "GET",
        header: {
          "X-WX-SERVICE": serviceName
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
              fail: (error) => reject(buildAudioError({
                stage: "generated_write",
                code: error && error.errCode ? error.errCode : "",
                message: error && error.errMsg ? error.errMsg : "歌曲文件写入失败。",
                rawError: error
              }))
            });
            return;
          }

          if (index < serviceNames.length - 1) {
            tryRequest(index + 1);
            return;
          }

          reject(buildAudioError({
            stage: "generated_stream",
            statusCode: response.statusCode,
            message: "当前没有拿到可播放的小歌音频。",
            responseData: response.data
          }));
        },
        fail: (error) => {
          if (index < serviceNames.length - 1) {
            tryRequest(index + 1);
            return;
          }

          reject(buildAudioError({
            stage: "generated_stream",
            code: error && error.errCode ? error.errCode : "",
            message: error && error.errMsg ? error.errMsg : "当前无法连接歌曲播放服务。",
            rawError: error
          }));
        }
      });
    };

    tryRequest(0);
  });
}

function downloadGeneratedSongTempFile(sourceUrl, song) {
  if (!sourceUrl) {
    return Promise.reject(new Error("当前没有拿到可播放的小歌音频。"));
  }
  const filePath = buildGeneratedSongTempFilePath(song, sourceUrl);
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: sourceUrl,
      success: (response) => {
        const tempFilePath = response && (response.tempFilePath || response.filePath);
        if (!response || response.statusCode < 200 || response.statusCode >= 300 || !tempFilePath) {
          reject(buildAudioError({
            stage: "generated_download",
            statusCode: response && response.statusCode,
            message: "当前没有拿到可播放的小歌音频。",
            responseData: response && response.data ? response.data : null,
          }));
          return;
        }
        copyFileWithOverwrite(tempFilePath, filePath)
          .then(resolve)
          .catch((error) => reject(buildAudioError({
            stage: "generated_copy",
            code: error && error.errCode ? error.errCode : "",
            message: error && error.errMsg ? error.errMsg : "歌曲文件写入失败。",
            rawError: error,
          })));
      },
      fail: (error) => reject(buildAudioError({
        stage: "generated_download",
        code: error && error.errCode ? error.errCode : "",
        message: error && error.errMsg ? error.errMsg : "当前无法连接歌曲播放服务。",
        rawError: error,
      })),
    });
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
    activeTab: RESULT_TABS.PLAYLIST,
    profileNickname: FALLBACK_NICKNAME,
    profileAvatarUrl: "",
    profileAvatarFileId: "",
    supportsInlineAudio: SUPPORT_INLINE_AUDIO,
    playingTrackIndex: -1,
    loadingTrackIndex: -1,
    copiedTrackIndex: -1,
    audioRetryCount: 0,
    showNicknameAuth: false,
    posterGenerating: false,
    posterReady: false,
    posterImagePath: "",
    showPosterPreview: false,
    reportEntryCtaText: pickReportEntryCtaText(),
    reminderEnabled: false,
    reminderLoading: false,
    reminderLoadingText: "",
    reminderTimeText: "明天 18:00",
    reminderDateText: "明天",
    ...buildSongCreationState("", getAnswers()),
  },

  onShow() {
    this.audioFilePromiseCache = this.audioFilePromiseCache || {};
    this.audioErrorLogs = this.audioErrorLogs || [];
    this.autoAdvanceOnEnd = false;
    this.autoAdvanceTimer = null;
    this.loadResult();
  },

  onShareAppMessage() {
    const playlistTitle =
      this.data &&
      this.data.result &&
      this.data.result.playlist &&
      this.data.result.playlist.title
        ? String(this.data.result.playlist.title).trim()
        : "";
    trackUserEvent({
      type: "share_app_message",
      page: "result",
      playlistTitle,
    }).catch(() => {});
    return {
      title: playlistTitle
        ? `我刚拿到一份「${playlistTitle}」AOTD，来测测你的夜晚小歌`
        : "我刚拿到今晚的 AOTD，来测测你的夜晚小歌",
      path: "/pages/landing/index",
      imageUrl: DEFAULT_SHARE_IMAGE,
    };
  },

  onShareTimeline() {
    const playlistTitle =
      this.data &&
      this.data.result &&
      this.data.result.playlist &&
      this.data.result.playlist.title
        ? String(this.data.result.playlist.title).trim()
        : "";
    trackUserEvent({
      type: "share_timeline",
      page: "result",
      playlistTitle,
    }).catch(() => {});
    return {
      title: playlistTitle
        ? `我刚拿到一份「${playlistTitle}」AOTD，来测测你的夜晚小歌`
        : "我刚拿到今晚的 AOTD，来测测你的夜晚小歌",
      query: "",
      imageUrl: DEFAULT_SHARE_IMAGE,
    };
  },

  onUnload() {
    if (this.autoPlayTimer) {
      clearTimeout(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
    if (this.copyTrackResetTimer) {
      clearTimeout(this.copyTrackResetTimer);
      this.copyTrackResetTimer = null;
    }
    if (this.autoAdvanceTimer) {
      clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
    }
    this.destroyAudio();
    this.destroySongAudio();
    this.resetSongGenerationProgress();
  },

  onHide() {
    if (this.autoPlayTimer) {
      clearTimeout(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
    if (this.copyTrackResetTimer) {
      clearTimeout(this.copyTrackResetTimer);
      this.copyTrackResetTimer = null;
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
    if (this.songAudioContext) {
      this.songAudioContext.stop();
      this.setData({
        playingSong: false,
      });
    }
    this.resetSongGenerationProgress();
  },

  getCurrentSongCreationSignature() {
    return buildSongCreationSignature(this.data.result, getAnswers());
  },

  persistSongCreationState(extra) {
    if (!this.data.result) {
      return;
    }
    const snapshot = Object.assign(
      {
        signature: this.getCurrentSongCreationSignature(),
        titleText: this.data.titleText || "",
        selectedVocalProfile: this.data.selectedVocalProfile || "",
        generatingSong: Boolean(this.data.generatingSong),
        taskId: this.currentAotdSongTaskId || 0,
        taskStartedAt: this.currentAotdSongTaskStartedAt || 0,
        songResult: this.data.songResult || null,
        songMetaText: this.data.songMetaText || "",
        generationNote: this.data.generationNote || "",
        savedSongPath: this.data.savedSongPath || "",
        generatedSongTempFilePath: this.generatedSongTempFilePath || "",
        generatedSongSourceUrl: this.generatedSongSourceUrl || "",
        updatedAt: Date.now(),
      },
      extra || {},
    );
    setStorage(STORAGE_KEYS.songCreationState, snapshot);
  },

  clearPersistedSongCreationState() {
    clearSongCreationState();
    this.currentAotdSongTaskId = 0;
    this.currentAotdSongTaskStartedAt = 0;
  },

  restoreSongCreationState(result) {
    const snapshot = getStorage(STORAGE_KEYS.songCreationState, null);
    if (!snapshot || !result) {
      return false;
    }
    if (snapshot.signature !== buildSongCreationSignature(result, getAnswers())) {
      return false;
    }
    const hasLiveTask = snapshot.generatingSong && snapshot.taskId;
    this.currentAotdSongTaskId = hasLiveTask ? Number(snapshot.taskId || 0) : 0;
    this.currentAotdSongTaskStartedAt = hasLiveTask ? Number(snapshot.taskStartedAt || Date.now()) : 0;
    this.generatedSongTempFilePath = snapshot.generatedSongTempFilePath || "";
    this.generatedSongSourceUrl = snapshot.generatedSongSourceUrl || "";
    this.setData({
      titleText: snapshot.titleText || stripPlaylistPrefix(result.playlist.title).slice(0, MAX_SONG_TITLE_LENGTH),
      selectedVocalProfile: snapshot.selectedVocalProfile || "",
      generatingSong: Boolean(hasLiveTask),
      generationText: hasLiveTask ? "正在继续为你制作..." : "正在为你制作...",
      songResult: hasLiveTask ? null : snapshot.songResult || null,
      songMetaText: hasLiveTask ? "" : snapshot.songMetaText || "",
      generationNote: hasLiveTask ? "刚刚的小歌还在继续生成，回来后会自动接着查询结果。" : snapshot.generationNote || "",
      savedSongPath: hasLiveTask ? "" : snapshot.savedSongPath || "",
      loadingSong: false,
      playingSong: false,
    });
    if (hasLiveTask) {
      this.startSongGenerationProgress();
      this.resumeAotdSongTaskPolling(snapshot.taskId, {
        silent: true,
        taskStartedAt: snapshot.taskStartedAt,
      });
    } else if (snapshot.songResult) {
      this.resetSongGenerationProgress();
    }
    return true;
  },

  async resumeAotdSongTaskPolling(taskId, options) {
    if (!taskId) {
      return;
    }
    const pollingToken = Date.now();
    this.songPollingToken = pollingToken;
    this.currentAotdSongTaskId = Number(taskId);
    if (options && options.taskStartedAt) {
      this.currentAotdSongTaskStartedAt = Number(options.taskStartedAt);
    }
    try {
      const remainingMs = Math.max(
        30000,
        SONG_CREATION_RESUME_WINDOW_MS - (Date.now() - Number(this.currentAotdSongTaskStartedAt || Date.now())),
      );
      const payload = await waitForAotdSongTask(taskId, {
        initialPayload: options && options.initialPayload ? options.initialPayload : undefined,
        timeoutMs: remainingMs,
      });
      if (this.songPollingToken !== pollingToken) {
        return;
      }
      const song = payload.song || {};
      const vocalLabel = buildVocalProfileLabel(this.data.selectedVocalProfile);
      await this.completeSongGenerationProgress();
      this.setData({
        generatingSong: false,
        generationText: "正在为你制作...",
        showGenerationProgress: false,
        songResult: song,
        songMetaText: buildSongMetaText(song, vocalLabel),
        generationNote: payload.meta && payload.meta.note ? payload.meta.note : `这次按${vocalLabel}方向做了你的 AOTD。`,
        savedSongPath: "",
        loadingSong: false,
      });
      this.currentAotdSongTaskId = 0;
      this.currentAotdSongTaskStartedAt = 0;
      this.persistSongCreationState({
        generatingSong: false,
        taskId: 0,
        taskStartedAt: 0,
        songResult: song,
        songMetaText: buildSongMetaText(song, vocalLabel),
        generationNote: payload.meta && payload.meta.note ? payload.meta.note : `这次按${vocalLabel}方向做了你的 AOTD。`,
      });
      trackUserEvent({
        type: "aotd_song_generate_success",
        titleText: this.data.titleText,
        durationSeconds: Number(song.durationSeconds || 0),
        mode: song.mode,
        vocalProfile: this.data.selectedVocalProfile,
        resumed: Boolean(options && options.silent),
      }).catch(() => {});
    } catch (error) {
      if (this.songPollingToken !== pollingToken) {
        return;
      }
      const message = error && error.message ? error.message : "制作失败，请稍后再试";
      if (isSongGenerationStillRunningMessage(message)) {
        this.setData({
          generatingSong: false,
          generationText: "正在为你制作...",
          generationNote: SONG_CREATION_CONTINUE_MESSAGE,
        });
        this.resetSongGenerationProgress();
        this.persistSongCreationState({
          generatingSong: true,
          taskId: this.currentAotdSongTaskId || Number(taskId),
          taskStartedAt: this.currentAotdSongTaskStartedAt || Date.now(),
          generationNote: SONG_CREATION_CONTINUE_MESSAGE,
        });
        if (!(options && options.silent)) {
          wx.showToast({
            title: "小歌还在继续生成，稍后回来就能接着看",
            icon: "none",
          });
        }
        return;
      }
      this.setData({
        generatingSong: false,
        generationText: "正在为你制作...",
      });
      this.resetSongGenerationProgress();
      this.clearPersistedSongCreationState();
      if (!(options && options.silent)) {
        wx.showToast({
          title: message,
          icon: "none",
        });
      }
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
        playingTrackIndex: -1,
        loadingTrackIndex: -1,
        showNicknameAuth: isFallbackNickname(nickname),
        posterReady: false,
        posterImagePath: "",
        showPosterPreview: false,
        ...buildSongCreationState(cached.playlist.title, answers),
      });
      this.restoreSongCreationState(applyCoverTitle(cached));
      trackUserEvent({ type: "result_view_cached", answers }).catch(() => {});
      this.autoPlayTopTrack(cached);
      this.refreshEveningReminderStatus();
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
        playingTrackIndex: -1,
        loadingTrackIndex: -1,
        showNicknameAuth: isFallbackNickname(nickname),
        posterReady: false,
        posterImagePath: "",
        showPosterPreview: false,
        ...buildSongCreationState(result.playlist.title, answers),
      });
      this.restoreSongCreationState(applyCoverTitle(result));
      trackUserEvent({ type: "result_view", answers }).catch(() => {});
      this.autoPlayTopTrack(result);
      this.refreshEveningReminderStatus();
    } catch (error) {
      this.setData({
        loading: false,
        errorMessage: error && error.message ? error.message : "生成歌单失败，请稍后再试。"
      });
    }
  },

  async refreshEveningReminderStatus() {
    try {
      const payload = await requestEveningReminderStatus();
      const remindAt = payload && payload.reminder && payload.reminder.remindAt ? new Date(payload.reminder.remindAt) : null;
      this.setData({
        reminderEnabled: Boolean(payload && payload.subscribed),
        reminderTimeText: remindAt ? `${remindAt.getMonth() + 1}月${remindAt.getDate()}日 18:00` : "明天 18:00",
        reminderDateText: formatReminderDateText(remindAt),
      });
    } catch (error) {
      console.warn("[aotd] reminder status failed:", error && error.message ? error.message : error);
    }
  },

  async ensureReminderSessionReady() {
    const cachedUserId = getStorage(STORAGE_KEYS.userId, "");
    const cachedIsAnonymous = getStorage(STORAGE_KEYS.isAnonymous, true);
    if (cachedUserId && !cachedIsAnonymous) {
      return true;
    }

    const app = typeof getApp === "function" ? getApp() : null;
    if (app && typeof app.ensureUserSession === "function") {
      await app.ensureUserSession();
    } else if (app && typeof app.bootstrapUser === "function") {
      await app.bootstrapUser();
    }
    if (app && typeof app.refreshProfile === "function") {
      await app.refreshProfile();
    }

    const nextUserId = getStorage(STORAGE_KEYS.userId, "");
    const nextIsAnonymous = getStorage(STORAGE_KEYS.isAnonymous, true);
    return Boolean(nextUserId && !nextIsAnonymous);
  },

  async submitEveningReminderWithRetry() {
    const loginReady = await this.ensureReminderSessionReady();
    if (!loginReady) {
      throw new Error("请先完成微信登录，再开启继续陪伴");
    }

    try {
      return await Promise.race([
        createEveningReminder(),
        wait(10000).then(() => {
          throw new Error("开启继续陪伴超时，请再试一次");
        }),
      ]);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      if (!/Current account has not completed wx login/i.test(message)) {
        throw error;
      }
      const retryReady = await this.ensureReminderSessionReady();
      if (!retryReady) {
        throw new Error("请先完成微信登录，再开启继续陪伴");
      }
      return Promise.race([
        createEveningReminder(),
        wait(10000).then(() => {
          throw new Error("开启继续陪伴超时，请再试一次");
        }),
      ]);
    }
  },

  async handleSubscribeReminder() {
    if (this.data.reminderEnabled || this.data.reminderLoading) {
      return;
    }
    this.setData({
      reminderLoading: true,
      reminderLoadingText: "请在弹窗里点允许",
    });
    try {
      const subscribeResult = await withPromise(wx.requestSubscribeMessage, {
        tmplIds: [EVENING_REMINDER_TEMPLATE_ID],
      });
      const status = subscribeResult && subscribeResult[EVENING_REMINDER_TEMPLATE_ID];
      if (status !== "accept") {
        throw new Error(status === "reject" ? "你刚刚没有打开提醒" : "当前无法开启提醒");
      }
      this.setData({
        reminderLoadingText: "正在开启继续陪伴",
      });
      const payload = await this.submitEveningReminderWithRetry();
      const remindAt = payload && payload.reminder && payload.reminder.remindAt ? new Date(payload.reminder.remindAt) : null;
      this.setData({
        reminderEnabled: true,
        reminderLoading: false,
        reminderLoadingText: "",
        reminderTimeText: remindAt ? `${remindAt.getMonth() + 1}月${remindAt.getDate()}日 18:00` : "明天 18:00",
        reminderDateText: formatReminderDateText(remindAt),
      });
      trackUserEvent({
        type: "evening_reminder_accept",
        templateId: EVENING_REMINDER_TEMPLATE_ID,
      }).catch(() => {});
      wx.showToast({
        title: "已开启下班提醒",
        icon: "success",
      });
    } catch (error) {
      this.setData({
        reminderLoading: false,
        reminderLoadingText: "",
      });
      const rawMessage = error && error.message ? error.message : "开启提醒失败";
      const message =
        rawMessage === "Current account has not completed wx login"
          ? "请先完成微信登录，再开启继续陪伴"
          : rawMessage;
      wx.showToast({
        title: message,
        icon: "none",
      });
    }
  },

  handleRetry() {
    this.loadResult();
  },

  handleSwitchTab(event) {
    const nextTab = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.tab : "";
    if (!nextTab || nextTab === this.data.activeTab) {
      return;
    }
    this.setData({
      activeTab: nextTab,
    });
  },

  handleSongTitleInput(event) {
    const nextValue = event && event.detail ? String(event.detail.value || "") : "";
    const trimmedValue = nextValue.slice(0, MAX_SONG_TITLE_LENGTH);
    if (nextValue.length > MAX_SONG_TITLE_LENGTH && !this.songTitleLimitToastShown) {
      this.songTitleLimitToastShown = true;
      wx.showToast({
        title: `标题最多 ${MAX_SONG_TITLE_LENGTH} 个字，后面的先帮你截掉了`,
        icon: "none",
      });
      wait(1600).then(() => {
        this.songTitleLimitToastShown = false;
      });
    }
    this.setData({
      titleText: trimmedValue,
    });
    this.persistSongCreationState({
      titleText: trimmedValue,
    });
  },

  handleSelectVocalProfile(event) {
    const value = event && event.currentTarget ? event.currentTarget.dataset.value : "";
    if (!value || value === this.data.selectedVocalProfile) {
      return;
    }
    const label = buildVocalProfileLabel(value);
    this.setData({
      selectedVocalProfile: value,
    });
    this.persistSongCreationState({
      selectedVocalProfile: value,
    });
    wx.showToast({
      title: `已选${label}`,
      icon: "none",
    });
  },

  setSongGenerationProgressStep(stepIndex) {
    const step = GENERATION_PROGRESS_STEPS[stepIndex];
    if (!step) {
      return;
    }
    this.setData({
      showGenerationProgress: true,
      generationProgressStepIndex: stepIndex,
      generationProgressPercent: step.progress,
      generationProgressText: step.text,
    });
  },

  startSongGenerationProgress() {
    this.resetSongGenerationProgress();
    this.setSongGenerationProgressStep(0);
    this.songGenerationHoldTick = 0;
    this.songGenerationProgressTimer = setInterval(() => {
      const currentStep = this.data.generationProgressStepIndex;
      const holdStep = GENERATION_PROGRESS_STEPS.length - 1;
      if (currentStep < holdStep) {
        this.setSongGenerationProgressStep(currentStep + 1);
        return;
      }
      const nextPercent = Math.min(96, Number(this.data.generationProgressPercent || 0) + 1);
      const nextText =
        GENERATION_PROGRESS_HOLD_TEXTS[this.songGenerationHoldTick % GENERATION_PROGRESS_HOLD_TEXTS.length] ||
        GENERATION_PROGRESS_HOLD_TEXTS[0];
      this.songGenerationHoldTick += 1;
      this.setData({
        showGenerationProgress: true,
        generationProgressPercent: nextPercent,
        generationProgressText: nextText,
      });
    }, 1800);
  },

  async completeSongGenerationProgress() {
    if (this.songGenerationProgressTimer) {
      clearInterval(this.songGenerationProgressTimer);
      this.songGenerationProgressTimer = null;
    }
    this.setData({
      showGenerationProgress: true,
      generationProgressStepIndex: GENERATION_PROGRESS_STEPS.length - 1,
      generationProgressPercent: 100,
      generationProgressText: "已经做好，正在为你打开小歌...",
    });
    await wait(420);
  },

  resetSongGenerationProgress() {
    if (this.songGenerationProgressTimer) {
      clearInterval(this.songGenerationProgressTimer);
      this.songGenerationProgressTimer = null;
    }
    this.setData({
      showGenerationProgress: false,
      generationProgressStepIndex: -1,
      generationProgressPercent: 0,
      generationProgressText: "",
    });
    this.songGenerationHoldTick = 0;
  },

  async handleGenerateMyAotd() {
    const result = this.data.result;
    const titleText = String(this.data.titleText || "").trim();
    const vocalProfile = this.data.selectedVocalProfile;
    if (!titleText) {
      wx.showToast({
        title: "先输入主标题",
        icon: "none",
      });
      return;
    }
    if (!vocalProfile) {
      wx.showToast({
        title: "先选一个人声",
        icon: "none",
      });
      return;
    }
    this.setData({
      generatingSong: true,
      generationText: "正在编排你的 AOTD...",
      songResult: null,
      songMetaText: "",
      generationNote: "",
      savedSongPath: "",
    });
    this.startSongGenerationProgress();
    try {
      const created = await createAotdSongTask({
        titleText,
        playlistTitle: result.playlist.title,
        answers: result.answers,
        tracks: result.playlist.tracks.map(mapTrackForSongGeneration),
        vocalProfile,
      });
      const createdTask = created && created.task ? created.task : null;
      const styleHit = createdTask && createdTask.meta ? createdTask.meta.styleHit : null;
      const pendingNote =
        styleHit && styleHit.summary
          ? `这次会优先按「${styleHit.summary}」这档曲风来做，切到后台再回来也会接着查结果。`
          : "小歌已经开始制作了，切到后台再回来也会接着查结果。";
      this.currentAotdSongTaskId = createdTask && createdTask.id ? Number(createdTask.id) : 0;
      this.currentAotdSongTaskStartedAt = Date.now();
      this.persistSongCreationState({
        generatingSong: true,
        taskId: this.currentAotdSongTaskId,
        taskStartedAt: this.currentAotdSongTaskStartedAt,
        songResult: null,
        songMetaText: "",
        generationNote: pendingNote,
      });
      await this.resumeAotdSongTaskPolling(this.currentAotdSongTaskId, {
        initialPayload: created,
        taskStartedAt: this.currentAotdSongTaskStartedAt,
      });
    } catch (error) {
      this.setData({
        generatingSong: false,
        generationText: "正在为你制作...",
      });
      this.resetSongGenerationProgress();
      this.clearPersistedSongCreationState();
      wx.showToast({
        title: error && error.message ? error.message : "制作失败，请稍后再试",
        icon: "none",
      });
    }
  },

  ensureSongAudioContext() {
    if (this.songAudioContext) {
      return this.songAudioContext;
    }
    const audioContext = wx.createInnerAudioContext();
    audioContext.autoplay = true;
    audioContext.obeyMuteSwitch = false;
    audioContext.onWaiting(() => {
      this.setData({
        loadingSong: true,
      });
    });
    audioContext.onCanplay(() => {
      this.setData({
        loadingSong: false,
      });
    });
    audioContext.onPlay(() => {
      this.setData({
        loadingSong: false,
      });
    });
    audioContext.onStop(() => {
      this.setData({
        playingSong: false,
        loadingSong: false,
      });
    });
    audioContext.onEnded(() => {
      this.setData({
        playingSong: false,
        loadingSong: false,
      });
    });
    audioContext.onError(() => {
      this.setData({
        playingSong: false,
        loadingSong: false,
      });
      wx.showToast({
        title: "播放失败，请重试",
        icon: "none",
      });
    });
    this.songAudioContext = audioContext;
    return audioContext;
  },

  destroySongAudio() {
    if (this.songAudioContext) {
      this.songAudioContext.destroy();
      this.songAudioContext = null;
    }
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
    try {
      const tempFilePath = await fetchGeneratedSongTempFileViaCloudContainer(sourceUrl, song);
      this.generatedSongTempFilePath = tempFilePath;
      this.generatedSongSourceUrl = sourceUrl;
      this.persistSongCreationState({
        generatedSongTempFilePath: tempFilePath,
        generatedSongSourceUrl: sourceUrl,
      });
      return tempFilePath;
    } catch (error) {
      console.warn("[aotd-song] resolve generated song playable url failed", {
        message: error && error.message ? error.message : String(error || "")
      });
    }
    try {
      const tempFilePath = await downloadGeneratedSongTempFile(sourceUrl, song);
      this.generatedSongTempFilePath = tempFilePath;
      this.generatedSongSourceUrl = sourceUrl;
      this.persistSongCreationState({
        generatedSongTempFilePath: tempFilePath,
        generatedSongSourceUrl: sourceUrl,
      });
      return tempFilePath;
    } catch (error) {
      console.warn("[aotd-song] direct generated song download failed", {
        message: error && error.message ? error.message : String(error || "")
      });
    }
    return sourceUrl;
  },

  playSongAudio(url) {
    if (!url) {
      return;
    }
    const audioContext = this.ensureSongAudioContext();
    this.setData({
      loadingSong: true,
      playingSong: false,
    });
    audioContext.src = url;
    audioContext.title = "我的 AOTD 小歌";
    audioContext.play();
    this.setData({
      playingSong: true,
    });
  },

  async handleToggleGeneratedSongPlay() {
    if (!this.data.songResult || !this.data.songResult.audioUrl) {
      return;
    }
    if (this.data.loadingSong) {
      return;
    }
    if (this.data.playingSong && this.songAudioContext) {
      this.songAudioContext.stop();
      return;
    }
    try {
      const playableUrl = this.data.savedSongPath || await this.resolveGeneratedSongPlayableUrl(this.data.songResult.audioUrl);
      this.playSongAudio(playableUrl);
    } catch (error) {
      wx.showToast({
        title: error && error.message ? error.message : "播放失败，请重试",
        icon: "none",
      });
    }
  },

  async handleSaveGeneratedSong() {
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
      this.persistSongCreationState({
        savedSongPath: savedFilePath,
      });
      wx.hideLoading();
      wx.showToast({
        title: "音频已保存到本地",
        icon: "success",
      });
    } catch (error) {
      wx.hideLoading();
      const message = error && error.errMsg ? error.errMsg : error && error.message ? error.message : "";
      wx.showToast({
        title: message || "保存失败，请重试",
        icon: "none",
      });
    }
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
    clearSongCreationState();
    trackUserEvent({ type: "restart_questionnaire" }).catch(() => {});
    wx.redirectTo({
      url: "/pages/landing/index"
    });
  },

  handleCopyTrackKeyword(event) {
    const { index } = event.currentTarget.dataset;
    const numericIndex = Number(index);
    const result = this.data.result;
    const track = result && result.playlist && result.playlist.tracks ? result.playlist.tracks[numericIndex] : null;
    if (!track) {
      return;
    }
    const keyword = buildTrackKeyword(track);
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
        if (this.copyTrackResetTimer) {
          clearTimeout(this.copyTrackResetTimer);
        }
        this.setData({
          copiedTrackIndex: numericIndex,
        });
        this.copyTrackResetTimer = setTimeout(() => {
          this.setData({
            copiedTrackIndex: -1,
          });
          this.copyTrackResetTimer = null;
        }, 1800);
        trackUserEvent({
          type: "playlist_copy_keyword",
          trackRank: track.rank,
          title: track.song && track.song.title,
          artist: track.song && track.song.artist,
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
    const tx = (value) => (value / POSTER_TEMPLATE_WIDTH) * POSTER_WIDTH;
    const ty = (value) => (value / POSTER_TEMPLATE_HEIGHT) * POSTER_HEIGHT;
    const title = stripPlaylistPrefix(poster.result.playlist.title);
    const posterCopy = buildPosterShortCopy(poster.result);
    const nickname = poster && poster.nickname ? String(poster.nickname).trim() : "";
    const posterOwner = buildPosterOwnerLine(nickname);
    const posterSubtitle =
      poster && poster.result && poster.result.playlist && poster.result.playlist.subtitle
        ? String(poster.result.playlist.subtitle).trim()
        : "";
    const songs = poster.result.playlist.tracks.slice(0, 5);

    if (poster.templateImage) {
      ctx.drawImage(poster.templateImage, 0, 0, POSTER_WIDTH, POSTER_HEIGHT);
    } else {
      ctx.fillStyle = "#f8edf1";
      ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
    }

    const profileY = ty(104) + 10;
    if (poster.avatarImage) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(tx(92) + 10, profileY, tx(24), 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(poster.avatarImage, tx(68) + 10, profileY - tx(24), tx(48), tx(48));
      ctx.restore();
    }

    ctx.fillStyle = "#d96e94";
    ctx.font = `${Math.round(tx(36))}px sans-serif`;
    ctx.fillText(posterOwner, tx(116) + 15, ty(108) + 18);

    ctx.fillStyle = "#e38aaa";
    ctx.font = `600 ${Math.round(tx(62))}px sans-serif`;
    const titleY = ty(245) - 15;
    ctx.fillText(title, tx(88), titleY, tx(520));
    const titleBottom = titleY;

    ctx.fillStyle = "rgba(90, 73, 82, 0.84)";
    ctx.font = `${Math.round(tx(36))}px sans-serif`;
    const copyBottom = wrapPosterText(ctx, posterCopy.kicker, tx(88), titleBottom + ty(124), tx(860), ty(44), 2);
    wrapPosterText(ctx, posterCopy.subline, tx(88), copyBottom + ty(12), tx(860), ty(44), 2);

    if (poster.avatarImage) {
      const recordAvatarRadius = tx(111);
      const recordAvatarCenterX = tx(216) + 57;
      const recordAvatarCenterY = ty(760) + 23;
      ctx.save();
      ctx.beginPath();
      ctx.arc(recordAvatarCenterX, recordAvatarCenterY, recordAvatarRadius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        poster.avatarImage,
        recordAvatarCenterX - recordAvatarRadius,
        recordAvatarCenterY - recordAvatarRadius,
        recordAvatarRadius * 2,
        recordAvatarRadius * 2
      );
      ctx.restore();
    }

    ctx.fillStyle = "rgba(224, 131, 165, 0.95)";
    ctx.font = `${Math.round(tx(36))}px sans-serif`;
    ctx.fillText("Track List", tx(470) + 80, ty(470) + 40);
    ctx.fillStyle = "rgba(96, 78, 87, 0.74)";
    ctx.font = `${Math.round(tx(26))}px sans-serif`;
    ctx.fillText("今晚唱片里的 5 首歌", tx(470) + 80, ty(506) + 40);

    songs.forEach((track, index) => {
      const top = ty(552 + index * 98) + 40;
      ctx.fillStyle = "#db7c9e";
      ctx.font = `${Math.round(tx(18))}px sans-serif`;
      ctx.fillText(`0${index + 1}`.slice(-2), tx(470) + 80, top + ty(18));

      ctx.fillStyle = "#41343d";
      ctx.font = `${Math.round(tx(25))}px sans-serif`;
      const songTitle = track.song && track.song.title ? track.song.title : "未知曲目";
      ctx.fillText(songTitle, tx(536) + 80, top + ty(16));

      ctx.fillStyle = "rgba(78,63,72,0.72)";
      ctx.font = `${Math.round(tx(16))}px sans-serif`;
      const artist = track.song && track.song.artist ? track.song.artist : "";
      wrapPosterText(ctx, artist, tx(536) + 80, top + ty(50), tx(206), ty(18), 1);
    });

    if (poster.qrCodeImage) {
      const qrSize = tx(190);
      const qrX = POSTER_WIDTH - qrSize - tx(74);
      const qrY = POSTER_HEIGHT - qrSize - ty(72) - 90;
      ctx.save();
      // Use multiply blend so the white square background disappears on the poster.
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(poster.qrCodeImage, qrX, qrY, qrSize, qrSize);
      ctx.restore();
    }
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
      const templateImage = await this.loadCanvasImage(posterCanvas.canvas, POSTER_TEMPLATE_PATH).catch((error) => {
        console.warn("[aotd] poster template load failed", {
          errMsg: error && error.errMsg ? error.errMsg : "",
          message: error && error.message ? error.message : "",
        });
        return null;
      });
      const qrCodeImage = await this.loadCanvasImage(posterCanvas.canvas, POSTER_QRCODE_PATH).catch((error) => {
        console.warn("[aotd] poster qrcode load failed", {
          errMsg: error && error.errMsg ? error.errMsg : "",
          message: error && error.message ? error.message : "",
        });
        return null;
      });
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
        templateImage,
        qrCodeImage,
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
      wx.showToast({
        title: "试听结束～",
        icon: "none"
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
        content: buildFriendlyPlaylistPlaybackMessage(),
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
            content: buildFriendlyPlaylistPlaybackMessage(),
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
          content: buildFriendlyPlaylistPlaybackMessage(),
          showCancel: false
        });
      });
  }
});
