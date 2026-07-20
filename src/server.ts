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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const webRoot = path.join(projectRoot, "web");
const port = Number(process.env.PORT || 4173);

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

function handleHealth(res: HttpResponse) {
  const workbookPath = path.resolve(process.env.AOTD_WORKBOOK_PATH || "data/AOTD_500_Song_Library_Enhanced.xlsx");
  sendJson(res, 200, {
    ok: true,
    service: "aotd-agent",
    port,
    workbookPath,
    workbookExists: fsSync.existsSync(workbookPath),
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
    const agent = new AotdAgent();
    const result = await agent.run(payload, {
      excludeSongIds: getExcludeSongIds(payload),
      excludeSongKeys: getExcludeSongKeys(payload),
    });
    sendJson(res, 200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    sendJson(res, 500, { error: message });
  }
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
    }

    const upstreamResponse = await fetch(resolution.audioUrl, {
      headers: upstreamHeaders,
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
    handleHealth(res);
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
  console.log(`AOTD web server running at http://localhost:${port}`);
});
