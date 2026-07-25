import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ResolveTrackUrlOptions {
  title?: string;
  artist?: string;
  keyword?: string;
  originalId?: string;
}

interface NeteasePlayableTrack {
  id?: number | string;
  url?: string | null;
  level?: string | null;
  type?: string | null;
  code?: number;
  fee?: number;
}

interface NeteasePlayableResponse {
  data?: NeteasePlayableTrack[];
  code?: number;
  msg?: string;
}

interface NeteaseSearchArtist {
  name?: string;
}

interface NeteaseSearchSong {
  id?: number | string;
  name?: string;
  artists?: NeteaseSearchArtist[];
}

interface NeteaseSearchResponse {
  result?: {
    songs?: NeteaseSearchSong[];
  };
}

export interface NeteaseTrackResolution {
  targetUrl: string;
  matchedSongId?: string;
  matchedSongName?: string;
  matchedArtistNames?: string[];
  matchScore?: number;
  searchKeyword: string;
  source: "original_id" | "search_match" | "search_fallback" | "empty";
}

export interface NeteaseAudioResolution {
  playable: boolean;
  audioUrl?: string;
  matchedSongId?: string;
  searchKeyword: string;
  source: "resolved_song_id" | "external_api" | "unavailable" | "empty";
  message?: string;
}

export interface CachedNeteasePreview {
  title: string;
  artist: string;
  originalId?: string;
  matchedSongId?: string;
  audioPath?: string;
  cached: boolean;
  source: string;
  message?: string;
}

const NETEASE_AUDIO_API_BASE = process.env.NETEASE_AUDIO_API_BASE || "https://api.91videos.vip";
const NETEASE_PREVIEW_BYTES = 384 * 1024;
const NETEASE_PREVIEW_TIMEOUT_MS = 15000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");
const generatedPreviewRoot = path.join(projectRoot, "web", "generated", "aotd-song", "reference-previews");

function asString(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[()[\]{}'".,!?/\\\-_:;|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactText(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function buildSongUrl(songId: string): string {
  return `https://music.163.com/#/song?id=${encodeURIComponent(songId)}`;
}

function buildSearchUrl(keyword: string): string {
  return `https://music.163.com/#/search/m/?s=${encodeURIComponent(keyword)}`;
}

function buildSearchKeyword(options: ResolveTrackUrlOptions): string {
  return asString(options.keyword) || [asString(options.title), asString(options.artist)].filter(Boolean).join(" ").trim();
}

function buildPlayableApiUrl(songId: string): URL {
  const apiUrl = new URL("/song/url/v1", NETEASE_AUDIO_API_BASE);
  apiUrl.searchParams.set("id", songId);
  apiUrl.searchParams.set("level", "standard");
  apiUrl.searchParams.set("unblock", "true");
  return apiUrl;
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-z0-9-_]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function detectExtensionFromContentType(contentType: string | null): string {
  const normalized = asString(contentType).toLowerCase();
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

function getArtistNames(song: NeteaseSearchSong): string[] {
  return (song.artists || []).map((artist) => asString(artist.name)).filter(Boolean);
}

function scoreSongMatch(song: NeteaseSearchSong, options: ResolveTrackUrlOptions): number {
  const targetTitle = asString(options.title);
  const targetArtist = asString(options.artist);
  const normalizedTargetTitle = normalizeText(targetTitle);
  const normalizedTargetArtist = normalizeText(targetArtist);
  const compactTargetTitle = compactText(targetTitle);
  const compactTargetArtist = compactText(targetArtist);

  const songTitle = asString(song.name);
  const songArtists = getArtistNames(song).join(" ");
  const normalizedSongTitle = normalizeText(songTitle);
  const normalizedSongArtists = normalizeText(songArtists);
  const compactSongTitle = compactText(songTitle);
  const compactSongArtists = compactText(songArtists);

  let score = 0;

  if (normalizedTargetTitle && normalizedSongTitle === normalizedTargetTitle) {
    score += 80;
  } else if (compactTargetTitle && compactSongTitle === compactTargetTitle) {
    score += 70;
  } else if (normalizedTargetTitle && normalizedSongTitle.includes(normalizedTargetTitle)) {
    score += 55;
  } else if (normalizedTargetTitle && normalizedTargetTitle.includes(normalizedSongTitle)) {
    score += 45;
  }

  if (normalizedTargetArtist && normalizedSongArtists === normalizedTargetArtist) {
    score += 60;
  } else if (compactTargetArtist && compactSongArtists === compactTargetArtist) {
    score += 50;
  } else if (normalizedTargetArtist && normalizedSongArtists.includes(normalizedTargetArtist)) {
    score += 35;
  } else if (normalizedTargetArtist && normalizedTargetArtist.includes(normalizedSongArtists)) {
    score += 25;
  }

  const keyword = buildSearchKeyword(options);
  const keywordTokens = normalizeText(keyword).split(" ").filter(Boolean);
  const searchable = `${normalizedSongTitle} ${normalizedSongArtists}`;
  keywordTokens.forEach((token) => {
    if (searchable.includes(token)) {
      score += 4;
    }
  });

  return score;
}

export async function resolveNeteaseTrack(options: ResolveTrackUrlOptions): Promise<NeteaseTrackResolution> {
  const originalId = asString(options.originalId);
  if (originalId) {
    return {
      targetUrl: buildSongUrl(originalId),
      matchedSongId: originalId,
      searchKeyword: buildSearchKeyword(options),
      source: "original_id",
    };
  }

  const keyword = buildSearchKeyword(options);
  if (!keyword) {
    return {
      targetUrl: "https://music.163.com/",
      searchKeyword: "",
      source: "empty",
    };
  }

  const apiUrl = new URL("https://music.163.com/api/search/get/web");
  apiUrl.searchParams.set("csrf_token", "");
  apiUrl.searchParams.set("s", keyword);
  apiUrl.searchParams.set("type", "1");
  apiUrl.searchParams.set("offset", "0");
  apiUrl.searchParams.set("total", "true");
  apiUrl.searchParams.set("limit", "10");

  const response = await fetch(apiUrl, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      referer: "https://music.163.com/",
    },
  });

  if (!response.ok) {
    return {
      targetUrl: buildSearchUrl(keyword),
      searchKeyword: keyword,
      source: "search_fallback",
    };
  }

  const data = (await response.json()) as NeteaseSearchResponse;
  const songs = data.result?.songs || [];
  if (!songs.length) {
    return {
      targetUrl: buildSearchUrl(keyword),
      searchKeyword: keyword,
      source: "search_fallback",
    };
  }

  const bestMatch = songs
    .map((song) => ({ song, score: scoreSongMatch(song, options) }))
    .sort((left, right) => right.score - left.score)[0];

  const songId = asString(bestMatch?.song?.id);
  if (!songId) {
    return {
      targetUrl: buildSearchUrl(keyword),
      searchKeyword: keyword,
      source: "search_fallback",
    };
  }

  return {
    targetUrl: buildSongUrl(songId),
    matchedSongId: songId,
    matchedSongName: asString(bestMatch.song?.name),
    matchedArtistNames: getArtistNames(bestMatch.song),
    matchScore: bestMatch.score,
    searchKeyword: keyword,
    source: "search_match",
  };
}

async function resolvePlayableSongId(options: ResolveTrackUrlOptions): Promise<{ songId?: string; searchKeyword: string; source: "resolved_song_id" | "empty" }> {
  const originalId = asString(options.originalId);
  if (originalId) {
    return {
      songId: originalId,
      searchKeyword: buildSearchKeyword(options),
      source: "resolved_song_id",
    };
  }

  const resolution = await resolveNeteaseTrack(options);
  return {
    songId: asString(resolution.matchedSongId),
    searchKeyword: resolution.searchKeyword,
    source: resolution.searchKeyword ? "resolved_song_id" : "empty",
  };
}

export async function resolveNeteaseAudio(options: ResolveTrackUrlOptions): Promise<NeteaseAudioResolution> {
  const { songId, searchKeyword, source } = await resolvePlayableSongId(options);
  if (!songId) {
    return {
      playable: false,
      searchKeyword,
      source: "empty",
      message: "No song id available for playback.",
    };
  }

  const response = await fetch(buildPlayableApiUrl(songId), {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      accept: "application/json,text/plain,*/*",
      referer: "https://music.163.com/",
    },
  });

  if (!response.ok) {
    return {
      playable: false,
      matchedSongId: songId,
      searchKeyword,
      source: "unavailable",
      message: `Playable api request failed with status ${response.status}.`,
    };
  }

  const data = (await response.json()) as NeteasePlayableResponse;
  const playableTrack = (data.data || []).find((item) => asString(item.id) === songId) || data.data?.[0];
  const audioUrl = asString(playableTrack?.url);

  if (!audioUrl) {
    return {
      playable: false,
      matchedSongId: songId,
      searchKeyword,
      source: "unavailable",
      message: asString(data.msg) || "Audio url unavailable.",
    };
  }

  return {
    playable: true,
    audioUrl,
    matchedSongId: songId,
    searchKeyword,
    source: "external_api",
  };
}

export async function cacheNeteaseTrackPreviews(
  tracks: ResolveTrackUrlOptions[],
): Promise<CachedNeteasePreview[]> {
  const results: CachedNeteasePreview[] = [];
  for (const track of tracks.slice(0, 5)) {
    const title = asString(track.title);
    const artist = asString(track.artist);
    const originalId = asString(track.originalId);
    if (!title && !artist && !originalId) {
      continue;
    }
    try {
      const resolution = await resolveNeteaseAudio(track);
      if (!resolution.playable || !resolution.audioUrl) {
        results.push({
          title,
          artist,
          originalId,
          matchedSongId: resolution.matchedSongId,
          cached: false,
          source: resolution.source,
          message: resolution.message,
        });
        continue;
      }
      const response = await fetch(resolution.audioUrl, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
          referer: "https://music.163.com/",
          range: `bytes=0-${NETEASE_PREVIEW_BYTES - 1}`,
        },
        signal: AbortSignal.timeout(NETEASE_PREVIEW_TIMEOUT_MS),
      });
      if (!response.ok) {
        results.push({
          title,
          artist,
          originalId,
          matchedSongId: resolution.matchedSongId,
          cached: false,
          source: "preview_fetch",
          message: `Preview request failed: ${response.status}`,
        });
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const extension = detectExtensionFromContentType(response.headers.get("content-type"));
      const fileStem =
        sanitizeName(originalId || `${title || "aotd"}-${artist || "preview"}`) || `aotd-preview-${crypto.randomUUID().slice(0, 8)}`;
      const fileName = `${fileStem}-${crypto.randomUUID().slice(0, 8)}.${extension}`;
      const absolutePath = path.join(generatedPreviewRoot, fileName);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, buffer);
      results.push({
        title,
        artist,
        originalId,
        matchedSongId: resolution.matchedSongId,
        cached: true,
        source: resolution.source,
        audioPath: `/generated/aotd-song/reference-previews/${fileName}`,
      });
    } catch (error) {
      results.push({
        title,
        artist,
        originalId,
        cached: false,
        source: "preview_fetch",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export async function resolveNeteaseTrackUrl(options: ResolveTrackUrlOptions): Promise<string> {
  const resolution = await resolveNeteaseTrack(options);
  return resolution.targetUrl;
}
