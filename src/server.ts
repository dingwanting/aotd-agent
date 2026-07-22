import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AotdAgent } from "./agents/aotd-agent.js";
import type { AotdQuestionnaireAnswers } from "./domain/aotd/types.js";
import { resolveNeteaseAudio, resolveNeteaseTrackUrl } from "./integrations/netease.js";
import { loadEnv } from "./config/env.js";
import { exchangeWxCodeForOpenId } from "./auth/wx-login.js";
import { userStore, type UserRecord } from "./auth/user-store.js";
import { userStateStore, type QuestionDeckIds, type UserProfileRecord } from "./persistence/user-state-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const webRoot = path.join(projectRoot, "web");
const port = Number(process.env.PORT || 4173);
const AUDIO_STREAM_FETCH_TIMEOUT_MS = 12000;
const DEFAULT_AUDIO_PREVIEW_BYTES = 256 * 1024;
const USER_ID_COOKIE = "aotd_uid";

// 部署版本指纹：每次代码改动必须 bump，方便从云托管日志确认跑的是哪个版本
// 同时启动时打 dist 文件 hash + 文件 mtime + git HEAD，可以一眼看出"是否在跑新代码"
const DEPLOY_VERSION = "aotd-2026-07-22-r9-avatar-poster-v1";

const appEnv = loadEnv();

function shortHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function readRetrieverFingerprint(): {
  hash: string;
  size: number;
  mtime: string;
  path: string;
} | null {
  try {
    const retrieverPath = path.join(__dirname, "domain", "aotd", "retriever.js");
    const content = fsSync.readFileSync(retrieverPath, "utf-8");
    const stat = fsSync.statSync(retrieverPath);
    return {
      hash: shortHash(content),
      size: stat.size,
      mtime: stat.mtime.toISOString(),
      path: retrieverPath,
    };
  } catch (error) {
    return null;
  }
}

const retrieverFingerprint = readRetrieverFingerprint();

type HttpRequest = IncomingMessage;
type HttpResponse = ServerResponse<IncomingMessage>;

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

async function readRequestBody(req: HttpRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

function sendJson(res: HttpResponse, statusCode: number, payload: unknown) {
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendRedirect(res: HttpResponse, location: string, statusCode = 302) {
  res.writeHead(statusCode, { location });
  res.end();
}

async function handleHealth(res: HttpResponse) {
  const workbookPath = path.resolve(process.env.AOTD_WORKBOOK_PATH || "data/AOTD_500_Song_Library_Enhanced.xlsx");
  const memoryEnabled = await userStateStore.isEnabled();
  const userCount = memoryEnabled ? await userStateStore.countUsers() : userStore.getUserCount();
  sendJson(res, 200, {
    ok: true,
    service: "aotd-agent",
    deployVersion: DEPLOY_VERSION,
    retriever: retrieverFingerprint,
    port,
    workbookPath,
    workbookExists: fsSync.existsSync(workbookPath),
    auth: {
      mode: appEnv.wxAppId && appEnv.wxSecret ? "wx-code2session" : "anonymous-only",
      userCount,
      wxConfigured: Boolean(appEnv.wxAppId && appEnv.wxSecret),
      memoryEnabled,
    },
  });
}

function readCookie(req: HttpRequest, name: string): string {
  const raw = req.headers.cookie || "";
  if (!raw) return "";
  const parts = raw.split(";");
  for (const part of parts) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return "";
}

function setSessionCookie(res: HttpResponse, value: string) {
  // session cookie：关浏览器失效，跟前端 sessionStorage 行为一致
  res.setHeader(
    "Set-Cookie",
    `${USER_ID_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax`,
  );
}

function readUserIdFromRequest(req: HttpRequest): string {
  const headerId = (req.headers["x-aotd-user-id"] || req.headers["X-AOTD-User-Id"]) as string | undefined;
  if (headerId && typeof headerId === "string" && headerId.trim()) {
    return headerId.trim();
  }
  return readCookie(req, USER_ID_COOKIE);
}

function readUser(req: HttpRequest): UserRecord | undefined {
  const userId = readUserIdFromRequest(req);
  if (!userId) return undefined;
  return userStore.get(userId);
}

function publicProfile(
  record:
    | Pick<UserRecord, "userId" | "nickname" | "avatarFileId" | "isAnonymous">
    | Pick<UserProfileRecord, "userId" | "nickname" | "avatarFileId" | "isAnonymous">
    | undefined,
): { userId: string; nickname: string; avatarFileId?: string; isAnonymous: boolean } | null {
  if (!record) return null;
  return {
    userId: record.userId,
    nickname: record.nickname,
    avatarFileId: record.avatarFileId,
    isAnonymous: record.isAnonymous,
  };
}

async function ensurePersistedUser(
  userId: string,
  options?: { nickname?: string; avatarFileId?: string; isAnonymous?: boolean; openid?: string },
): Promise<UserProfileRecord | null> {
  if (!userId) return null;
  const existing = await userStateStore.findByUserId(userId);
  if (existing) {
    if (
      (options?.nickname && options.nickname !== existing.profile.nickname) ||
      (options?.avatarFileId !== undefined && options.avatarFileId !== existing.profile.avatarFileId)
    ) {
      const updated = await userStateStore.updateProfile(userId, {
        nickname: options?.nickname,
        avatarFileId: options?.avatarFileId,
      });
      return updated?.profile || existing.profile;
    }
    await userStateStore.touchUser(userId);
    return existing.profile;
  }

  const profile: UserProfileRecord = {
    userId,
    openid: options?.openid,
    nickname: options?.nickname || "朋友",
    avatarFileId: options?.avatarFileId,
    isAnonymous: options?.isAnonymous ?? !userId.startsWith("wx-"),
    createdAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  };
  await userStateStore.saveUser(profile);
  return profile;
}

async function handleAuthProfile(req: HttpRequest, res: HttpResponse) {
  if (req.method === "POST") {
    const userId = readUserIdFromRequest(req);
    if (!userId) {
      sendJson(res, 401, { error: "Missing user session" });
      return;
    }
    const body = await readJsonBody(req);
    if (!body || typeof body !== "object") {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }
    const payload = body as { nickname?: string; avatarFileId?: string };
    const nickname = typeof payload.nickname === "string" ? payload.nickname.trim() : "";
    const avatarFileId = typeof payload.avatarFileId === "string" ? payload.avatarFileId.trim() : "";
    const profile = await ensurePersistedUser(userId, {
      nickname,
      avatarFileId: avatarFileId || undefined,
      isAnonymous: !userId.startsWith("wx-"),
    });
    const memory = await userStateStore.getMemory(userId);
    sendJson(res, 200, { ok: true, profile: publicProfile(profile || undefined), memory });
    return;
  }

  const userId = readUserIdFromRequest(req);
  if (userId) {
    const profile = await ensurePersistedUser(userId, { isAnonymous: !userId.startsWith("wx-") });
    const memory = await userStateStore.getMemory(userId);
    sendJson(res, 200, { ok: true, profile: publicProfile(profile || undefined), memory });
    return;
  }

  // 没 userId 的请求（首次访问）颁发一个匿名 userId 并 set-cookie
  const created = userStore.createAnonymous();
  setSessionCookie(res, created.userId);
  await userStateStore.saveUser({
    userId: created.userId,
    nickname: created.nickname,
    isAnonymous: true,
    createdAt: created.createdAt,
    lastSeenAt: created.lastSeenAt,
  });
  const memory = await userStateStore.getMemory(created.userId);
  sendJson(res, 200, { ok: true, profile: publicProfile(created), memory, issued: true });
}

async function readJsonBody(req: HttpRequest): Promise<unknown> {
  const rawBody = await readRequestBody(req);
  if (!rawBody.trim()) return {};
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

async function handleWxLogin(req: HttpRequest, res: HttpResponse) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }
  const payload = body as { code?: string; nickname?: string };
  const code = typeof payload.code === "string" ? payload.code.trim() : "";
  const nickname = typeof payload.nickname === "string" ? payload.nickname.trim() : "";

  if (!code) {
    sendJson(res, 400, { error: "Missing code" });
    return;
  }

  // 1) 优先尝试用 code 换 openid（需要 WX_APPID + WX_SECRET 配齐）
  const exchange = await exchangeWxCodeForOpenId(appEnv.wxAppId, appEnv.wxSecret, code);
  if (exchange.ok) {
    const persisted = await userStateStore.findByOpenid(exchange.data.openid);
    const record = persisted?.profile || {
      ...userStore.upsertByOpenid(exchange.data.openid, nickname),
      openid: exchange.data.openid,
    };
    const nextProfile: UserProfileRecord = {
      userId: record.userId,
      openid: exchange.data.openid,
      nickname: nickname || record.nickname || "朋友",
      isAnonymous: false,
      createdAt: record.createdAt,
      lastSeenAt: new Date().toISOString(),
    };
    await userStateStore.saveUser(nextProfile);
    const memory = await userStateStore.getMemory(nextProfile.userId);
    setSessionCookie(res, nextProfile.userId);
    sendJson(res, 200, {
      ok: true,
      profile: publicProfile(nextProfile),
      memory,
      isNew: !persisted,
    });
    return;
  }

  // 详细打日志：失败原因 + 是否缺凭据 + 微信返回的 errcode
  console.warn(
    `[auth] wx-login failed reason=${exchange.failure.reason}` +
      ` appIdSet=${Boolean(appEnv.wxAppId)} secretSet=${Boolean(appEnv.wxSecret)}` +
      ` codeLen=${code.length}` +
      (exchange.failure.httpStatus ? ` httpStatus=${exchange.failure.httpStatus}` : "") +
      (exchange.failure.errcode ? ` errcode=${exchange.failure.errcode}` : "") +
      (exchange.failure.errmsg ? ` errmsg=${exchange.failure.errmsg}` : ""),
  );

  // 2) 没配 secret 或 code 失效：基于已有 userId 升级（如果有），否则发匿名
  //    同时把诊断信息（errcode/errmsg）回给前端，方便排查 secret 配置问题
  const currentUserId = readUserIdFromRequest(req);
  if (currentUserId) {
    const existing = await ensurePersistedUser(currentUserId, {
      nickname,
      isAnonymous: !currentUserId.startsWith("wx-"),
    });
    const memory = await userStateStore.getMemory(currentUserId);
    sendJson(res, 200, {
      ok: true,
      profile: publicProfile(existing || undefined),
      memory,
      fallback: "no-wx-session",
      diagnostic: {
        reason: exchange.failure.reason,
        appIdSet: Boolean(appEnv.wxAppId),
        secretSet: Boolean(appEnv.wxSecret),
        codeLen: code.length,
        errcode: exchange.failure.errcode,
        errmsg: exchange.failure.errmsg,
        httpStatus: exchange.failure.httpStatus,
        errorCode: exchange.failure.errorCode,
      },
    });
    return;
  }

  const created = userStore.createAnonymous();
  setSessionCookie(res, created.userId);
  await userStateStore.saveUser({
    userId: created.userId,
    nickname: created.nickname,
    isAnonymous: true,
    createdAt: created.createdAt,
    lastSeenAt: created.lastSeenAt,
  });
  const memory = await userStateStore.getMemory(created.userId);
  sendJson(res, 200, {
    ok: true,
    profile: publicProfile(created),
    memory,
    fallback: "no-wx-session",
    issued: true,
    diagnostic: {
      reason: exchange.failure.reason,
      appIdSet: Boolean(appEnv.wxAppId),
      secretSet: Boolean(appEnv.wxSecret),
      codeLen: code.length,
      errcode: exchange.failure.errcode,
      errmsg: exchange.failure.errmsg,
      httpStatus: exchange.failure.httpStatus,
      errorCode: exchange.failure.errorCode,
    },
  });
}

function isAnswersPayload(value: unknown): value is AotdQuestionnaireAnswers {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.consumptionSource === "string" &&
    typeof payload.emotionalNeed === "string" &&
    typeof payload.emotionalImagery === "string"
  );
}

function getExcludeSongIds(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.excludeSongIds)) {
    return [];
  }

  return payload.excludeSongIds.filter((item): item is string => typeof item === "string");
}

function getExcludeSongKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.excludeSongKeys)) {
    return [];
  }

  return payload.excludeSongKeys.filter((item): item is string => typeof item === "string");
}

function getRotationSeed(value: unknown): number | string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const payload = value as Record<string, unknown>;
  const seed = payload.rotationSeed;
  if (typeof seed === "number" || typeof seed === "string") {
    return seed;
  }
  return undefined;
}

function getQuestionDeckIds(value: unknown): QuestionDeckIds | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const payload = value as Record<string, unknown>;
  const source = payload.questionDeckIds;
  if (!source || typeof source !== "object") {
    return undefined;
  }
  const raw = source as Record<string, unknown>;
  return {
    consumptionSource: typeof raw.consumptionSource === "string" ? raw.consumptionSource : undefined,
    emotionalNeed: typeof raw.emotionalNeed === "string" ? raw.emotionalNeed : undefined,
    emotionalImagery: typeof raw.emotionalImagery === "string" ? raw.emotionalImagery : undefined,
  };
}

async function handleApi(req: HttpRequest, res: HttpResponse) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const rawBody = await readRequestBody(req);
  let payload: unknown;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!isAnswersPayload(payload)) {
    sendJson(res, 400, { error: "Invalid answers payload" });
    return;
  }

  try {
    const userId = readUserIdFromRequest(req);
    const questionDeckIds = getQuestionDeckIds(payload);
    const requestExcludeSongIds = getExcludeSongIds(payload);
    const requestExcludeSongKeys = getExcludeSongKeys(payload);
    let combinedExcludeSongIds = requestExcludeSongIds;
    let combinedExcludeSongKeys = requestExcludeSongKeys;

    if (userId) {
      await ensurePersistedUser(userId, { isAnonymous: !userId.startsWith("wx-") });
      const reused = await userStateStore.findCachedResult(userId, payload);
      if (reused) {
        const memory = await userStateStore.saveRecommendation({
          userId,
          answers: payload,
          result: reused,
          questionDeckIds,
          reusedFromHistory: true,
        });
        await userStateStore.appendEvent(userId, {
          type: "recommendation_reused",
          answers: payload,
        });
        sendJson(res, 200, { ...reused, meta: { reusedFromHistory: true }, memory });
        return;
      }

      const memoryExclusions = await userStateStore.getRecentExclusions(userId);
      combinedExcludeSongIds = [...new Set(memoryExclusions.excludeSongIds.concat(requestExcludeSongIds))];
      combinedExcludeSongKeys = [...new Set(memoryExclusions.excludeSongKeys.concat(requestExcludeSongKeys))];
      console.log(`[aotd] user=${userId} answers=${JSON.stringify(payload)}`);
    }

    const agent = new AotdAgent();
    const result = await agent.run(payload, {
      excludeSongIds: combinedExcludeSongIds,
      excludeSongKeys: combinedExcludeSongKeys,
      rotationSeed: getRotationSeed(payload),
    });
    if (userId) {
      const memory = await userStateStore.saveRecommendation({
        userId,
        answers: payload,
        result,
        questionDeckIds,
      });
      await userStateStore.appendEvent(userId, {
        type: "recommendation_generated",
        answers: payload,
      });
      sendJson(res, 200, { ...result, memory });
      return;
    }
    sendJson(res, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    sendJson(res, 500, { error: message });
  }
}

async function handleUserEvents(req: HttpRequest, res: HttpResponse) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  const userId = readUserIdFromRequest(req);
  if (!userId) {
    sendJson(res, 401, { error: "Missing user session" });
    return;
  }
  const body = await readJsonBody(req);
  if (!body || typeof body !== "object") {
    sendJson(res, 400, { error: "Invalid JSON body" });
    return;
  }
  await ensurePersistedUser(userId, { isAnonymous: !userId.startsWith("wx-") });
  await userStateStore.appendEvent(userId, body as Record<string, unknown>);
  sendJson(res, 200, { ok: true });
}

async function handleNeteasePlay(requestUrl: URL, res: HttpResponse) {
  const title = requestUrl.searchParams.get("title") || "";
  const artist = requestUrl.searchParams.get("artist") || "";
  const keyword = requestUrl.searchParams.get("keyword") || "";
  const originalId = requestUrl.searchParams.get("originalId") || "";

  try {
    const targetUrl = await resolveNeteaseTrackUrl({
      title,
      artist,
      keyword,
      originalId,
    });
    sendRedirect(res, targetUrl);
  } catch {
    const fallbackKeyword = keyword || [title, artist].filter(Boolean).join(" ").trim();
    const fallbackUrl = fallbackKeyword
      ? `https://music.163.com/#/search/m/?s=${encodeURIComponent(fallbackKeyword)}`
      : "https://music.163.com/";
    sendRedirect(res, fallbackUrl);
  }
}

async function handleNeteaseAudioResolve(requestUrl: URL, res: HttpResponse) {
  const title = requestUrl.searchParams.get("title") || "";
  const artist = requestUrl.searchParams.get("artist") || "";
  const keyword = requestUrl.searchParams.get("keyword") || "";
  const originalId = requestUrl.searchParams.get("originalId") || "";

  try {
    const resolution = await resolveNeteaseAudio({
      title,
      artist,
      keyword,
      originalId,
    });
    sendJson(res, resolution.playable ? 200 : 404, resolution);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to resolve audio stream";
    sendJson(res, 500, { playable: false, error: message });
  }
}

function copyStreamingHeaders(sourceHeaders: Headers, res: HttpResponse) {
  const passThroughHeaders = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"];
  passThroughHeaders.forEach((headerName) => {
    const headerValue = sourceHeaders.get(headerName);
    if (headerValue) {
      res.setHeader(headerName, headerValue);
    }
  });
}

async function handleNeteaseAudioStream(req: HttpRequest, requestUrl: URL, res: HttpResponse) {
  const title = requestUrl.searchParams.get("title") || "";
  const artist = requestUrl.searchParams.get("artist") || "";
  const keyword = requestUrl.searchParams.get("keyword") || "";
  const originalId = requestUrl.searchParams.get("originalId") || "";
  const previewBytesRaw = requestUrl.searchParams.get("previewBytes") || "";
  const previewBytes = Number.parseInt(previewBytesRaw, 10);

  try {
    const resolution = await resolveNeteaseAudio({
      title,
      artist,
      keyword,
      originalId,
    });

    if (!resolution.playable || !resolution.audioUrl) {
      sendJson(res, 404, resolution);
      return;
    }

    const upstreamHeaders: Record<string, string> = {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      referer: "https://music.163.com/",
    };
    if (req.headers.range) {
      upstreamHeaders.range = req.headers.range;
    } else if (Number.isFinite(previewBytes) && previewBytes > 0) {
      upstreamHeaders.range = `bytes=0-${previewBytes - 1}`;
    } else {
      upstreamHeaders.range = `bytes=0-${DEFAULT_AUDIO_PREVIEW_BYTES - 1}`;
    }

    const upstreamResponse = await fetch(resolution.audioUrl, {
      headers: upstreamHeaders,
      signal: AbortSignal.timeout(AUDIO_STREAM_FETCH_TIMEOUT_MS),
    });

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      sendJson(res, 502, {
        playable: false,
        error: `Upstream audio request failed with status ${upstreamResponse.status}`,
      });
      return;
    }

    res.statusCode = upstreamResponse.status;
    copyStreamingHeaders(upstreamResponse.headers, res);
    Readable.fromWeb(upstreamResponse.body as never).pipe(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to stream audio";
    sendJson(res, 500, { playable: false, error: message });
  }
}

async function handleStatic(urlPath: string, res: HttpResponse) {
  const requestedPath = urlPath === "/" ? "/pages/question-drain.html" : urlPath;
  const safePath = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(webRoot, safePath);

  try {
    const stat = await fs.stat(filePath);
    const resolvedPath = stat.isDirectory() ? path.join(filePath, "index.html") : filePath;
    const content = await fs.readFile(resolvedPath);
    const ext = path.extname(resolvedPath);
    res.writeHead(200, { "content-type": contentTypes[ext] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not Found");
  }
}

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/api/aotd/recommendation") {
    await handleApi(req, res);
    return;
  }

  if (requestUrl.pathname === "/api/health") {
    await handleHealth(res);
    return;
  }

  if (requestUrl.pathname === "/api/auth/profile") {
    await handleAuthProfile(req, res);
    return;
  }

  if (requestUrl.pathname === "/api/auth/wx-login") {
    await handleWxLogin(req, res);
    return;
  }

  if (requestUrl.pathname === "/api/user/events") {
    await handleUserEvents(req, res);
    return;
  }

  if (requestUrl.pathname === "/api/netease/play") {
    await handleNeteasePlay(requestUrl, res);
    return;
  }

  if (requestUrl.pathname === "/api/netease/audio/resolve") {
    await handleNeteaseAudioResolve(requestUrl, res);
    return;
  }

  if (requestUrl.pathname === "/api/netease/audio/stream") {
    await handleNeteaseAudioStream(req, requestUrl, res);
    return;
  }

  await handleStatic(requestUrl.pathname, res);
});

server.listen(port, () => {
  console.log(`[BOOT] deployVersion=${DEPLOY_VERSION}`);
  console.log(`[BOOT] retriever=${JSON.stringify(retrieverFingerprint)}`);
  console.log(`[BOOT] auth.mode=${appEnv.wxAppId && appEnv.wxSecret ? "wx-code2session" : "anonymous-only"}`);
  console.log(`AOTD web server running at http://localhost:${port}`);
});
