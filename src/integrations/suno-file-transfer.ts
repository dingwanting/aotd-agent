import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "../config/env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const generatedAudioRoot = path.join(projectRoot, "web", "generated", "aotd-song");
const FILE_UPLOAD_TIMEOUT_MS = 20000;
const REMOTE_FETCH_TIMEOUT_MS = 30000;

interface FileUploadResponse {
  success?: boolean;
  code?: number;
  msg?: string;
  data?: {
    fileName?: string;
    filePath?: string;
    downloadUrl?: string;
    mimeType?: string;
  };
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

export function resolveProjectPublicBaseUrl(): string {
  const env = loadEnv();
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

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.msg === "string" && record.msg.trim()) {
    return record.msg.trim();
  }
  return fallback;
}

function buildDataUrl(base64Data: string, fileFormat: string): string {
  const format = String(fileFormat || "mp3").toLowerCase();
  const mimeType =
    format === "wav"
      ? "audio/wav"
      : format === "m4a"
        ? "audio/mp4"
        : format === "aac"
          ? "audio/aac"
          : "audio/mpeg";
  return `data:${mimeType};base64,${base64Data}`;
}

function detectExtensionFromContentType(contentType: string | null): string {
  const normalized = String(contentType || "").toLowerCase();
  if (normalized.includes("audio/mpeg") || normalized.includes("audio/mp3")) {
    return "mp3";
  }
  if (normalized.includes("audio/wav")) {
    return "wav";
  }
  if (normalized.includes("audio/mp4") || normalized.includes("audio/x-m4a")) {
    return "m4a";
  }
  if (normalized.includes("audio/aac")) {
    return "aac";
  }
  return "mp3";
}

export async function uploadBase64FileToSuno(params: {
  apiKey: string;
  fileBase64: string;
  fileFormat: string;
  uploadPath: string;
  fileNamePrefix: string;
}): Promise<{ downloadUrl: string; mimeType: string }> {
  const env = loadEnv();
  const baseUrl = normalizeBaseUrl(env.aotdSongFileUploadBaseUrl);
  const extension = sanitizeName(params.fileFormat || "mp3") || "mp3";
  const fileName = `${sanitizeName(params.fileNamePrefix) || "aotd-file"}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
  const response = await fetch(`${baseUrl}/api/file-base64-upload`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      base64Data: buildDataUrl(params.fileBase64, extension),
      uploadPath: params.uploadPath.replace(/^\/+|\/+$/g, ""),
      fileName,
    }),
    signal: AbortSignal.timeout(FILE_UPLOAD_TIMEOUT_MS),
  });
  const payload = (await response.json().catch(() => ({}))) as FileUploadResponse;
  if (!response.ok || payload.success !== true || payload.code !== 200 || !payload.data?.downloadUrl) {
    throw new Error(extractErrorMessage(payload, `Suno file upload failed: ${response.status}`));
  }
  return {
    downloadUrl: payload.data.downloadUrl,
    mimeType: payload.data.mimeType || "",
  };
}

export async function persistBase64FileToProject(params: {
  fileBase64: string;
  fileFormat: string;
  targetSubDir: string;
  fileNamePrefix: string;
}): Promise<{ publicPath: string; publicUrl: string } | null> {
  const publicBaseUrl = resolveProjectPublicBaseUrl();
  if (!publicBaseUrl) {
    return null;
  }
  const extension = sanitizeName(params.fileFormat || "mp3") || "mp3";
  const fileName = `${sanitizeName(params.fileNamePrefix) || "aotd-file"}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
  const relativePath = `/generated/aotd-song/${params.targetSubDir.replace(/^\/+|\/+$/g, "")}/${fileName}`;
  const absolutePath = path.join(generatedAudioRoot, params.targetSubDir, fileName);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, Buffer.from(params.fileBase64, "base64"));
  return {
    publicPath: toPosixPath(relativePath),
    publicUrl: `${publicBaseUrl}${toPosixPath(relativePath)}`,
  };
}

export async function cacheRemoteAudioToLocal(params: {
  remoteUrl: string;
  targetSubDir: string;
  fileNamePrefix: string;
}): Promise<string> {
  const response = await fetch(params.remoteUrl, {
    method: "GET",
    signal: AbortSignal.timeout(REMOTE_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`下载远程音频失败: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const extension = detectExtensionFromContentType(response.headers.get("content-type"));
  const fileName = `${sanitizeName(params.fileNamePrefix) || "aotd-audio"}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
  const relativePath = `/generated/aotd-song/${params.targetSubDir.replace(/^\/+|\/+$/g, "")}/${fileName}`;
  const absolutePath = path.join(generatedAudioRoot, params.targetSubDir, fileName);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);
  return toPosixPath(relativePath);
}
