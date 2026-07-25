import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const generatedAudioRoot = path.join(projectRoot, "web", "generated", "aotd-song", "voice-persona");
const CREATE_TIMEOUT_MS = 20000;
const STATUS_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 2500;
const MAX_VALIDATE_POLLS = 20;
const MAX_GENERATE_POLLS = 30;
const MAX_AVAILABILITY_POLLS = 8;

interface VoiceValidateResponse {
  code?: number;
  msg?: string;
  data?: {
    taskId?: string;
    validateInfo?: string;
    voiceId?: string;
    isAvailable?: boolean;
    status?: string;
    errorCode?: number;
    errorMessage?: string;
  };
}

export interface PrepareSunoVoicePersonaParams {
  titleText: string;
  voiceBase64: string;
  voiceFormat: string;
  voiceDurationMs?: number;
}

export interface PreparedSunoVoicePersona {
  taskId: string;
  validateInfo: string;
  sourceVoiceUrl: string;
  status: string;
}

export interface FinalizeSunoVoicePersonaParams {
  validateTaskId: string;
  titleText: string;
  verifyVoiceBase64: string;
  verifyVoiceFormat: string;
}

export interface FinalizedSunoVoicePersona {
  taskId: string;
  voiceId: string;
  verifyVoiceUrl: string;
  isAvailable: boolean;
  status: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-z0-9-_]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.msg === "string" && record.msg.trim()) {
    return record.msg.trim();
  }
  const data = record.data as Record<string, unknown> | undefined;
  if (data && typeof data.errorMessage === "string" && data.errorMessage.trim()) {
    return data.errorMessage.trim();
  }
  return fallback;
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
  if (env.aotdPublicBaseUrl && isUsablePublicOrigin(env.aotdPublicBaseUrl)) {
    return normalizeBaseUrl(env.aotdPublicBaseUrl);
  }
  if (env.aotdSongCallbackUrl) {
    try {
      const callbackUrl = new URL(env.aotdSongCallbackUrl);
      if (isUsablePublicOrigin(callbackUrl.origin)) {
        return normalizeBaseUrl(callbackUrl.origin);
      }
    } catch {
      return "";
    }
  }
  return "";
}

async function persistPublicVoiceFile(params: {
  fileBase64: string;
  fileFormat: string;
  prefix: string;
  titleText: string;
}): Promise<{ publicPath: string; publicUrl: string }> {
  const env = loadEnv();
  const publicBaseUrl = resolvePublicBaseUrl(env);
  if (!publicBaseUrl) {
    throw new Error("请先配置可公网访问的 AOTD_PUBLIC_BASE_URL 或 AOTD_SONG_CALLBACK_URL");
  }
  const extension = sanitizeName(params.fileFormat || "mp3") || "mp3";
  const token = crypto
    .createHash("sha1")
    .update(`${params.prefix}|${params.titleText}|${params.fileBase64.slice(0, 128)}`)
    .digest("hex")
    .slice(0, 16);
  const fileName = `${sanitizeName(params.titleText || params.prefix) || params.prefix}-${token}.${extension}`;
  const relativePath = `/generated/aotd-song/voice-persona/${params.prefix}/${fileName}`;
  const absolutePath = path.join(generatedAudioRoot, params.prefix, fileName);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, Buffer.from(params.fileBase64, "base64"));
  return {
    publicPath: relativePath,
    publicUrl: `${publicBaseUrl}${toPosixPath(relativePath)}`,
  };
}

async function postJson(url: string, apiKey: string, body: object): Promise<VoiceValidateResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as VoiceValidateResponse;
  if (!response.ok || payload.code !== 200) {
    throw new Error(extractErrorMessage(payload, `Suno Voice request failed: ${response.status}`));
  }
  return payload;
}

async function getJson(url: string, apiKey: string): Promise<VoiceValidateResponse> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as VoiceValidateResponse;
  if (!response.ok || payload.code !== 200) {
    throw new Error(extractErrorMessage(payload, `Suno Voice query failed: ${response.status}`));
  }
  return payload;
}

function resolveVoiceApiConfig() {
  const env = loadEnv();
  if (!env.aotdSongApiKey || !env.aotdSongBaseUrl) {
    throw new Error("AOTD_SONG_API_KEY 或 AOTD_SONG_BASE_URL 未配置");
  }
  return {
    env,
    baseUrl: normalizeBaseUrl(env.aotdSongBaseUrl),
    apiKey: env.aotdSongApiKey,
    callbackUrl: env.aotdSongCallbackUrl || "https://example.com/api/aotd-song/callback",
  };
}

function buildVoiceName(titleText: string): string {
  return `${titleText || "我的 AOTD"} 音色`;
}

export async function prepareSunoVoicePersona(
  params: PrepareSunoVoicePersonaParams,
): Promise<PreparedSunoVoicePersona> {
  const { baseUrl, apiKey, callbackUrl } = resolveVoiceApiConfig();
  const sourceVoice = await persistPublicVoiceFile({
    fileBase64: params.voiceBase64,
    fileFormat: params.voiceFormat,
    prefix: "source",
    titleText: params.titleText,
  });
  const durationSeconds = Math.max(3, Math.min(10, Math.floor((params.voiceDurationMs || 10000) / 1000) || 8));
  const createPayload = await postJson(`${baseUrl}/api/v1/voice/validate`, apiKey, {
    voiceUrl: sourceVoice.publicUrl,
    vocalStartS: 0,
    vocalEndS: durationSeconds,
    language: "zh",
    callBackUrl: callbackUrl,
  });
  const taskId = createPayload.data?.taskId || "";
  if (!taskId) {
    throw new Error("Suno Voice 没有返回验证任务 ID");
  }
  for (let attempt = 0; attempt < MAX_VALIDATE_POLLS; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);
    const statusPayload = await getJson(
      `${baseUrl}/api/v1/voice/validate-info?taskId=${encodeURIComponent(taskId)}`,
      apiKey,
    );
    const status = String(statusPayload.data?.status || "");
    const validateInfo = String(statusPayload.data?.validateInfo || "").trim();
    if ((status === "wait_validating" || status === "success") && validateInfo) {
      return {
        taskId,
        validateInfo,
        sourceVoiceUrl: sourceVoice.publicUrl,
        status,
      };
    }
    if (status === "processing_validate_fail" || status === "fail") {
      throw new Error(statusPayload.data?.errorMessage || "生成验证短句失败");
    }
  }
  throw new Error("生成验证短句超时，请稍后再试");
}

export async function finalizeSunoVoicePersona(
  params: FinalizeSunoVoicePersonaParams,
): Promise<FinalizedSunoVoicePersona> {
  const { baseUrl, apiKey, callbackUrl } = resolveVoiceApiConfig();
  const verifyVoice = await persistPublicVoiceFile({
    fileBase64: params.verifyVoiceBase64,
    fileFormat: params.verifyVoiceFormat,
    prefix: "verify",
    titleText: params.titleText,
  });
  const createPayload = await postJson(`${baseUrl}/api/v1/voice/generate`, apiKey, {
    taskId: params.validateTaskId,
    verifyUrl: verifyVoice.publicUrl,
    voiceName: buildVoiceName(params.titleText),
    description: "created for AOTD personalized song generation",
    style: "Mandarin pop, late night, intimate vocal",
    singerSkillLevel: "beginner",
    callBackUrl: callbackUrl,
  });
  const voiceTaskId = createPayload.data?.taskId || "";
  if (!voiceTaskId) {
    throw new Error("Suno Voice 没有返回音色任务 ID");
  }
  let voiceId = "";
  let status = "";
  for (let attempt = 0; attempt < MAX_GENERATE_POLLS; attempt += 1) {
    await sleep(POLL_INTERVAL_MS);
    const statusPayload = await getJson(
      `${baseUrl}/api/v1/voice/record-info?taskId=${encodeURIComponent(voiceTaskId)}`,
      apiKey,
    );
    status = String(statusPayload.data?.status || "");
    voiceId = String(statusPayload.data?.voiceId || "").trim();
    if (status === "success" && voiceId) {
      break;
    }
    if (status === "fail" || status === "processing_validate_fail") {
      throw new Error(statusPayload.data?.errorMessage || "生成音色失败");
    }
  }
  if (!voiceId) {
    throw new Error("生成音色超时，请稍后再试");
  }
  let isAvailable = false;
  for (let attempt = 0; attempt < MAX_AVAILABILITY_POLLS; attempt += 1) {
    const availabilityPayload = await postJson(`${baseUrl}/api/v1/voice/check-voice`, apiKey, {
      task_id: voiceTaskId,
    });
    isAvailable = Boolean(availabilityPayload.data?.isAvailable);
    if (isAvailable) {
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return {
    taskId: voiceTaskId,
    voiceId,
    verifyVoiceUrl: verifyVoice.publicUrl,
    isAvailable,
    status: isAvailable ? "success" : status || "success",
  };
}
