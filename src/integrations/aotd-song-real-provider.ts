import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "../config/env.js";
import { cacheRemoteAudioToLocal, uploadBase64FileToSuno } from "./suno-file-transfer.js";

import type { GenerateAotdSongParams, GeneratedAotdSong } from "./aotd-song-provider.js";

interface RemoteSongResponse {
  code?: number;
  msg?: string;
  status?: string;
  taskId?: string;
  id?: string;
  audioUrl?: string;
  audio_url?: string;
  voiceSampleUrl?: string;
  voice_sample_url?: string;
  title?: string;
  summary?: string;
  durationSeconds?: number;
  duration_seconds?: number;
  data?: {
    taskId?: string;
    status?: string;
    response?: {
      data?: Array<{
        id?: string;
        audio_url?: string;
        audioUrl?: string;
        streamAudioUrl?: string;
        sourceStreamAudioUrl?: string;
        title?: string;
        tags?: string;
        prompt?: string;
        duration?: number;
        durationSeconds?: number;
        image_url?: string;
      }>;
      sunoData?: Array<{
        id?: string;
        audioUrl?: string;
        streamAudioUrl?: string;
        sourceStreamAudioUrl?: string;
        sourceAudioUrl?: string | null;
        title?: string;
        tags?: string;
        prompt?: string;
        duration?: number | null;
        createTime?: number;
      }>;
    };
  };
  error?: string | { message?: string };
}

interface NormalizedRemoteTrack {
  audioUrl: string;
  title?: string;
  tags?: string;
  duration?: number;
}

const CREATE_TIMEOUT_MS = 20000;
const STATUS_TIMEOUT_MS = 15000;
const MAX_PROVIDER_POLLS = 40;
const PROVIDER_POLL_INTERVAL_MS = 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const generatedAudioRoot = path.join(projectRoot, "web", "generated", "aotd-song");

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function normalizePath(pathTemplate: string, taskId?: string): string {
  const filled = taskId ? pathTemplate.replaceAll("{taskId}", encodeURIComponent(taskId)) : pathTemplate;
  return filled.startsWith("/") ? filled : `/${filled}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-z0-9-_]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error.trim();
  }
  if (record.error && typeof record.error === "object" && "message" in record.error && typeof record.error.message === "string") {
    return record.error.message;
  }
  if (typeof record.msg === "string" && record.msg.trim()) {
    return record.msg.trim();
  }
  return fallback;
}

function buildGenerationPrompt(request: GenerateAotdSongParams): string {
  const trackLine = request.tracks
    .slice(0, 5)
    .map((track) => [track.title, track.artist].filter(Boolean).join(" - "))
    .filter(Boolean)
    .join("；");
  return [
    `请围绕“${request.titleText}”创作一首属于用户的 AOTD 歌曲。`,
    `整体气质参考今晚歌单：${trackLine || request.playlistTitle}。`,
    "要求有真实人声、旋律完整、情绪陪伴感强，适合夜晚下班后独处收听。",
    "优先中文歌词，语气自然，不要过度煽情。",
  ].join("");
}

function buildUploadLyrics(request: GenerateAotdSongParams): string {
  const hook = request.titleText.trim() || "今晚先抱抱自己";
  return [
    "[Verse]",
    `${hook}`,
    "把今天慢慢放下",
    "让夜色替我说晚安",
    "",
    "[Chorus]",
    `${hook}`,
    "跟着今晚这份陪伴轻轻唱",
    "让心事有地方安放",
  ].join("\n");
}

function buildUploadStyle(request: GenerateAotdSongParams): string {
  const trackLine = request.tracks
    .slice(0, 5)
    .map((track) => [track.title, track.artist].filter(Boolean).join(" - "))
    .filter(Boolean)
    .join("；");
  return [
    "Mandarin pop",
    "late night",
    "healing",
    "intimate vocal",
    trackLine || request.playlistTitle || "playlist-inspired",
  ].join(", ");
}

function isUsablePublicOrigin(origin: string): boolean {
  try {
    const targetUrl = new URL(origin);
    const hostname = targetUrl.hostname.toLowerCase();
    if (!/^https?:$/i.test(targetUrl.protocol)) {
      return false;
    }
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "example.com") {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function resolvePublicBaseUrl(env: ReturnType<typeof loadEnv>): string {
  if (env.aotdPublicBaseUrl) {
    return isUsablePublicOrigin(env.aotdPublicBaseUrl) ? normalizeBaseUrl(env.aotdPublicBaseUrl) : "";
  }
  if (env.aotdSongCallbackUrl) {
    try {
      const callbackUrl = new URL(env.aotdSongCallbackUrl);
      return isUsablePublicOrigin(callbackUrl.origin) ? normalizeBaseUrl(callbackUrl.origin) : "";
    } catch {
      return "";
    }
  }
  return "";
}

async function persistVoiceSample(
  request: GenerateAotdSongParams,
  env: ReturnType<typeof loadEnv>,
): Promise<{ publicUrl: string; publicPath: string } | null> {
  if (!request.voiceBase64) {
    return null;
  }
  if (!env.aotdSongApiKey || !env.aotdSongFileUploadBaseUrl) {
    return null;
  }
  const uploaded = await uploadBase64FileToSuno({
    apiKey: env.aotdSongApiKey,
    fileBase64: request.voiceBase64,
    fileFormat: request.voiceFormat || "mp3",
    uploadPath: "aotd-song/voice-samples",
    fileNamePrefix: request.titleText || "aotd-voice",
  });
  const voiceFormat = sanitizeName(request.voiceFormat || "mp3") || "mp3";
  const fileToken = crypto
    .createHash("sha1")
    .update(`${request.titleText}|${request.playlistTitle}|${request.voiceBase64.slice(0, 128)}`)
    .digest("hex")
    .slice(0, 16);
  const fileName = `${sanitizeName(request.titleText || "aotd-voice") || "aotd-voice"}-${fileToken}.${voiceFormat}`;
  const relativePath = `/generated/aotd-song/voice-samples/${fileName}`;
  const targetPath = path.join(generatedAudioRoot, "voice-samples", fileName);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, Buffer.from(request.voiceBase64, "base64"));

  return {
    publicPath: relativePath,
    publicUrl: uploaded.downloadUrl,
  };
}

function buildUploadCoverRequest(
  request: GenerateAotdSongParams,
  env: ReturnType<typeof loadEnv>,
  voiceUpload: { publicUrl: string },
): Record<string, unknown> {
  const personaId = (request.voicePersonaId || env.aotdSongVoicePersonaId).trim();
  const personaModel = request.voicePersonaId ? "voice_persona" : env.aotdSongVoicePersonaModel.trim();
  const needsVoicePersonaModel = personaModel === "voice_persona";
  const model = needsVoicePersonaModel ? "V5_5" : env.aotdSongModel || "V4_5ALL";
  const payload: Record<string, unknown> = {
    uploadUrl: voiceUpload.publicUrl,
    customMode: true,
    instrumental: false,
    model,
    callBackUrl: env.aotdSongCallbackUrl || "https://example.com/api/aotd-song/callback",
    prompt: buildUploadLyrics(request),
    style: buildUploadStyle(request),
    title: request.titleText || "我的 AOTD 小歌",
    negativeTags: "heavy metal, aggressive rap, noisy edm, distorted screaming",
    styleWeight: 0.58,
    weirdnessConstraint: 0.35,
    audioWeight: 0.72,
  };
  if (personaId) {
    payload.personaId = personaId;
    payload.personaModel = personaModel || "style_persona";
  }
  return payload;
}

function buildTextGenerationRequest(
  request: GenerateAotdSongParams,
  env: ReturnType<typeof loadEnv>,
): Record<string, unknown> {
  const voicePersonaId = (request.voicePersonaId || env.aotdSongVoicePersonaId).trim();
  if (!voicePersonaId) {
    return {
      prompt: buildGenerationPrompt(request),
      customMode: false,
      instrumental: false,
      model: env.aotdSongModel || "V4_5ALL",
      callBackUrl: env.aotdSongCallbackUrl || "https://example.com/api/aotd-song/callback",
    };
  }
  return {
    customMode: true,
    instrumental: false,
    model: "V5_5",
    callBackUrl: env.aotdSongCallbackUrl || "https://example.com/api/aotd-song/callback",
    prompt: buildUploadLyrics(request),
    style: buildUploadStyle(request),
    title: request.titleText || "我的 AOTD 小歌",
    personaId: voicePersonaId,
    personaModel: "voice_persona",
    negativeTags: "heavy metal, aggressive rap, noisy edm, distorted screaming",
    styleWeight: 0.58,
    weirdnessConstraint: 0.35,
    audioWeight: 0.72,
  };
}

function extractTaskId(payload: RemoteSongResponse): string {
  return payload.taskId || payload.id || payload.data?.taskId || "";
}

function extractStatus(payload: RemoteSongResponse): string {
  return String(payload.status || payload.data?.status || "").toUpperCase();
}

function normalizeGeneratedSong(
  payload: RemoteSongResponse,
  request: GenerateAotdSongParams,
): GeneratedAotdSong | null {
  const rawTrack =
    (Array.isArray(payload.data?.response?.data) ? payload.data?.response?.data?.[0] : undefined) ||
    (Array.isArray(payload.data?.response?.sunoData) ? payload.data?.response?.sunoData?.[0] : undefined);
  const track: NormalizedRemoteTrack | null = rawTrack
    ? {
        audioUrl:
          rawTrack.audioUrl ||
          ("audio_url" in rawTrack ? rawTrack.audio_url || "" : "") ||
          ("streamAudioUrl" in rawTrack ? rawTrack.streamAudioUrl || "" : "") ||
          ("sourceStreamAudioUrl" in rawTrack ? rawTrack.sourceStreamAudioUrl || "" : ""),
        title: rawTrack.title,
        tags: rawTrack.tags,
        duration:
          ("durationSeconds" in rawTrack ? rawTrack.durationSeconds || 0 : 0) ||
          ("duration" in rawTrack ? Number(rawTrack.duration || 0) : 0),
      }
    : null;
  const audioUrl = payload.audioUrl || payload.audio_url || track?.audioUrl || "";
  if (!audioUrl) {
    return null;
  }
  return {
    title: payload.title || track?.title || request.titleText || "我的 AOTD 小歌",
    summary:
      payload.summary ||
      `已根据“${request.titleText}”与今晚歌单生成专属歌曲${track?.tags ? `，风格标签：${track.tags}` : ""}。`,
    durationSeconds: Number(payload.durationSeconds || payload.duration_seconds || track?.duration || 0) || 0,
    audioPath: audioUrl,
    voiceSamplePath: payload.voiceSampleUrl || payload.voice_sample_url || undefined,
    mode: "real",
    provider: "remote",
  };
}

async function postJson(url: string, apiKey: string, body: object): Promise<RemoteSongResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as RemoteSongResponse;
  if (!response.ok || payload.code === 400 || payload.code === 401 || payload.code === 404 || payload.code === 405 || payload.code === 413 || payload.code === 429 || payload.code === 430 || payload.code === 455 || payload.code === 500) {
    throw new Error(extractErrorMessage(payload, `AOTD song provider create failed: ${response.status}`));
  }
  return payload;
}

async function getJson(url: string, apiKey: string): Promise<RemoteSongResponse> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as RemoteSongResponse;
  if (!response.ok || payload.code === 400 || payload.code === 401 || payload.code === 404 || payload.code === 405 || payload.code === 413 || payload.code === 429 || payload.code === 430 || payload.code === 455 || payload.code === 500) {
    throw new Error(extractErrorMessage(payload, `AOTD song provider status failed: ${response.status}`));
  }
  return payload;
}

export function isRealAotdSongProviderConfigured(): boolean {
  const env = loadEnv();
  return env.aotdSongProvider === "remote" && Boolean(env.aotdSongApiKey && env.aotdSongBaseUrl);
}

export async function generateAotdSongViaRemoteProvider(
  params: GenerateAotdSongParams,
): Promise<GeneratedAotdSong> {
  const env = loadEnv();
  if (!env.aotdSongApiKey || !env.aotdSongBaseUrl) {
    throw new Error("AOTD_SONG_API_KEY 或 AOTD_SONG_BASE_URL 未配置");
  }

  const baseUrl = normalizeBaseUrl(env.aotdSongBaseUrl);
  const voiceUpload = await persistVoiceSample(params, env);

  let createPayload: RemoteSongResponse;
  try {
    if (voiceUpload) {
      const uploadCreateUrl = `${baseUrl}${normalizePath(env.aotdSongUploadCreatePath)}`;
      createPayload = await postJson(
        uploadCreateUrl,
        env.aotdSongApiKey,
        buildUploadCoverRequest(params, env, voiceUpload),
      );
    } else {
      const createUrl = `${baseUrl}${normalizePath(env.aotdSongCreatePath)}`;
      createPayload = await postJson(createUrl, env.aotdSongApiKey, buildTextGenerationRequest(params, env));
    }
  } catch (error) {
    if (!voiceUpload) {
      throw error;
    }
    console.warn("[aotd-song] upload-cover flow failed, fallback to prompt generation", {
      error: error instanceof Error ? error.message : String(error),
    });
    const createUrl = `${baseUrl}${normalizePath(env.aotdSongCreatePath)}`;
    createPayload = await postJson(createUrl, env.aotdSongApiKey, buildTextGenerationRequest(params, env));
  }

  const directSong = normalizeGeneratedSong(createPayload, params);
  if (directSong) {
    try {
      directSong.audioPath = await cacheRemoteAudioToLocal({
        remoteUrl: directSong.audioPath,
        targetSubDir: "remote-audio",
        fileNamePrefix: directSong.title || params.titleText || "aotd-song",
      });
    } catch (error) {
      console.warn("[aotd-song] failed to cache remote audio, keep original url", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (voiceUpload) {
      directSong.voiceSamplePath = voiceUpload.publicPath;
      directSong.summary = `已把你的标题录音接入上传音频链路，并结合今晚歌单生成专属歌曲。`;
    }
    return directSong;
  }

  const taskId = extractTaskId(createPayload);
  if (!taskId) {
    throw new Error("真实音乐服务未返回 taskId 或 audioUrl");
  }

  for (let attempt = 0; attempt < MAX_PROVIDER_POLLS; attempt += 1) {
    await sleep(PROVIDER_POLL_INTERVAL_MS);
    const statusUrl = `${baseUrl}${normalizePath(env.aotdSongStatusPath, taskId)}`;
    const statusPayload = await getJson(statusUrl, env.aotdSongApiKey);
    const status = extractStatus(statusPayload);

    const completedSong = normalizeGeneratedSong(statusPayload, params);
    if (completedSong) {
      try {
        completedSong.audioPath = await cacheRemoteAudioToLocal({
          remoteUrl: completedSong.audioPath,
          targetSubDir: "remote-audio",
          fileNamePrefix: completedSong.title || params.titleText || "aotd-song",
        });
      } catch (error) {
        console.warn("[aotd-song] failed to cache remote audio, keep original url", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (voiceUpload) {
        completedSong.voiceSamplePath = voiceUpload.publicPath;
        completedSong.summary =
          completedSong.summary || "已把你的标题录音接入上传音频链路，并结合今晚歌单生成专属歌曲。";
      }
      return completedSong;
    }
    if (status === "FAILED" || status === "ERROR") {
      throw new Error(extractErrorMessage(statusPayload, "真实音乐服务生成失败"));
    }
  }

  throw new Error("真实音乐服务生成超时");
}
