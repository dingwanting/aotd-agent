const {
  API_BASE_URL,
  USE_CLOUD_CONTAINER,
  CLOUD_ENV_ID,
  CLOUD_SERVICE_NAME,
  CLOUD_SERVICE_FALLBACKS,
} = require("./config");

const AUDIO_CACHE_MIN_BYTES = 1024;
const FULL_AUDIO_FETCH_TIMEOUT_MS = 60000;

const fullAudioPromiseCache = Object.create(null);
let prefetchQueue = Promise.resolve();

function normalizeTrack(track) {
  return {
    originalId: track && track.originalId ? String(track.originalId) : "",
    title: track && track.title ? String(track.title) : "",
    artist: track && track.artist ? String(track.artist) : "",
    keyword: track && track.keyword ? String(track.keyword) : "",
  };
}

function buildTrackKeyword(track) {
  const normalized = normalizeTrack(track);
  return normalized.keyword || [normalized.title, normalized.artist].filter(Boolean).join(" ").trim();
}

function buildTrackSignature(track) {
  const normalized = normalizeTrack(track);
  return [normalized.originalId, normalized.title, normalized.artist, buildTrackKeyword(normalized)].join("::");
}

function buildTempAudioFilePath(track) {
  const normalized = normalizeTrack(track);
  const rawName = normalized.originalId || `${normalized.title || "aotd"}-${normalized.artist || "full"}`;
  const safeName = String(rawName || "aotd-full")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `${wx.env.USER_DATA_PATH}/${safeName || "aotd-full"}-full-v2.mp3`;
}

function readLocalAudioFile(filePath) {
  const fs = wx.getFileSystemManager();
  return new Promise((resolve) => {
    fs.getFileInfo({
      filePath,
      success: (info) => resolve(Boolean(info && info.size >= AUDIO_CACHE_MIN_BYTES)),
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
  const normalized = normalizeTrack(track);
  const serviceNames = Array.from(
    new Set([CLOUD_SERVICE_NAME].concat(CLOUD_SERVICE_FALLBACKS || []).filter(Boolean))
  );
  const filePath = buildTempAudioFilePath(normalized);
  const fs = wx.getFileSystemManager();
  const data = {
    originalId: normalized.originalId,
    title: normalized.title,
    artist: normalized.artist,
    keyword: buildTrackKeyword(normalized),
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
  const normalized = normalizeTrack(track);
  const filePath = buildTempAudioFilePath(normalized);
  const params = [];
  if (normalized.originalId) {
    params.push(`originalId=${encodeURIComponent(normalized.originalId)}`);
  }
  if (normalized.title) {
    params.push(`title=${encodeURIComponent(normalized.title)}`);
  }
  if (normalized.artist) {
    params.push(`artist=${encodeURIComponent(normalized.artist)}`);
  }
  const keyword = buildTrackKeyword(normalized);
  if (keyword) {
    params.push(`keyword=${encodeURIComponent(keyword)}`);
  }
  params.push("full=1");

  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: `${API_BASE_URL}/api/netease/audio/stream?${params.join("&")}`,
      filePath,
      timeout: FULL_AUDIO_FETCH_TIMEOUT_MS,
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.filePath || response.tempFilePath || filePath);
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

async function ensureFullAudioFile(track) {
  const normalized = normalizeTrack(track);
  const filePath = buildTempAudioFilePath(normalized);
  const exists = await readLocalAudioFile(filePath);
  if (exists) {
    return filePath;
  }

  const signature = buildTrackSignature(normalized);
  if (fullAudioPromiseCache[signature]) {
    return fullAudioPromiseCache[signature];
  }

  const task = withTimeout(
    fetchFullAudioViaHttp(normalized).catch((error) => {
      if (!USE_CLOUD_CONTAINER) {
        throw error;
      }
      return fetchFullAudioViaCloudContainer(normalized);
    }),
    FULL_AUDIO_FETCH_TIMEOUT_MS
  ).finally(() => {
    delete fullAudioPromiseCache[signature];
  });

  fullAudioPromiseCache[signature] = task;
  return task;
}

function prefetchFullAudioTracks(tracks) {
  const list = Array.isArray(tracks) ? tracks.map((item) => normalizeTrack(item)).filter((item) => item.title || item.keyword) : [];
  prefetchQueue = prefetchQueue
    .catch(() => {})
    .then(async () => {
      for (let index = 0; index < list.length; index += 1) {
        try {
          await ensureFullAudioFile(list[index]);
        } catch (error) {
          console.warn("[aotd] full audio prefetch failed", {
            title: list[index].title,
            artist: list[index].artist,
            message: error && error.message ? error.message : "",
          });
        }
      }
    });
  return prefetchQueue;
}

module.exports = {
  normalizeTrack,
  buildTrackKeyword,
  buildTempAudioFilePath,
  ensureFullAudioFile,
  prefetchFullAudioTracks,
};
