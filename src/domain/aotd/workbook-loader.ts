import fs from "node:fs";
import path from "node:path";

import xlsx from "xlsx";

import type { SongDocument } from "./types.js";

interface SongLibraryRow {
  ID?: number | string;
  Song?: string;
  Artist?: string;
  Genre?: string;
  Energy?: number | string;
  PrimaryNeed?: string;
  Scene?: string;
  Weather?: string;
  Time?: string;
  Notes?: string;
  Language?: string;
  DrainTags?: string;
  NeedTags?: string;
  SceneTags?: string;
  WeatherTags?: string;
  TimeTags?: string;
  EnergyBucket?: string;
  IsPlayable?: string;
  IDStatus?: string;
  Priority?: number | string;
  CLIKeyword?: string;
  ReviewStatus?: string;
  OriginalID?: string;
  EncryptedID?: string;
}

function asString(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function splitTags(...values: unknown[]): string[] {
  return values
    .flatMap((value) => asString(value).split(/[\n,;/|]+/g))
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeEnergyBucket(value: unknown): SongDocument["energy"] {
  const bucket = asString(value).toLowerCase();
  if (bucket === "high") {
    return "high";
  }
  if (bucket === "medium") {
    return "medium";
  }
  return "low";
}

function normalizeLanguage(value: unknown): string {
  const raw = asString(value);
  return raw || "unknown";
}

function normalizeBooleanFlag(value: unknown): boolean {
  const raw = asString(value).toLowerCase();
  return raw === "y" || raw === "yes" || raw === "true" || raw === "1" || raw === "done";
}

function normalizePriority(value: unknown): number | undefined {
  const raw = asString(value);
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mapRowToSong(row: SongLibraryRow): SongDocument | null {
  const id = asString(row.ID);
  const title = asString(row.Song);
  const artist = asString(row.Artist);

  if (!id || !title || !artist) {
    return null;
  }

  return {
    id,
    title,
    artist,
    language: normalizeLanguage(row.Language),
    energy: normalizeEnergyBucket(row.EnergyBucket || row.Energy),
    primaryNeed: asString(row.PrimaryNeed),
    genre: asString(row.Genre),
    moods: splitTags(row.PrimaryNeed, row.DrainTags, row.Notes),
    scenes: splitTags(row.Scene, row.Weather, row.Time),
    tags: splitTags(
      row.Genre,
      row.NeedTags,
      row.SceneTags,
      row.WeatherTags,
      row.TimeTags,
      row.EnergyBucket,
      row.CLIKeyword,
      row.ReviewStatus,
    ),
    needTags: splitTags(row.PrimaryNeed, row.NeedTags),
    sceneTags: splitTags(row.Scene, row.SceneTags),
    weatherTags: splitTags(row.Weather, row.WeatherTags),
    timeTags: splitTags(row.Time, row.TimeTags),
    cliKeyword: asString(row.CLIKeyword),
    isPlayable: normalizeBooleanFlag(row.IsPlayable),
    idStatus: asString(row.IDStatus),
    reviewStatus: asString(row.ReviewStatus),
    originalId: asString(row.OriginalID) || undefined,
    encryptedId: asString(row.EncryptedID) || undefined,
    priority: normalizePriority(row.Priority),
  };
}

let workbookCache = new Map<string, SongDocument[]>();

export function loadSongsFromWorkbook(workbookPath: string): SongDocument[] {
  const { readFile, utils } = xlsx;
  const resolvedPath = path.resolve(workbookPath);
  const cached = workbookCache.get(resolvedPath);
  if (cached) {
    return cached;
  }

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Workbook not found: ${resolvedPath}`);
  }

  const workbook = readFile(resolvedPath);
  const sheet = workbook.Sheets.SongLibrary;
  if (!sheet) {
    throw new Error("Workbook missing SongLibrary sheet.");
  }

  const rows = utils.sheet_to_json<SongLibraryRow>(sheet, {
    defval: "",
    raw: false,
  });

  const songs = rows
    .map(mapRowToSong)
    .filter((item): item is SongDocument => Boolean(item));

  workbookCache.set(resolvedPath, songs);
  return songs;
}
