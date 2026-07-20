import fs from "node:fs";
import path from "node:path";

import xlsx from "xlsx";

import { loadEnv } from "../config/env.js";
import { resolveNeteaseTrack, type NeteaseTrackResolution } from "../integrations/netease.js";

interface SongLibraryRow {
  ID?: string | number;
  Song?: string;
  Artist?: string;
  OriginalID?: string;
  EncryptedID?: string;
  IDStatus?: string;
  IsPlayable?: string;
  CLIKeyword?: string;
  ReviewStatus?: string;
  [key: string]: unknown;
}

interface FillArgs {
  workbookPath: string;
  limit?: number;
  dryRun: boolean;
  onlyPending: boolean;
  backup: boolean;
}

interface FillReportItem {
  rowId: string;
  song: string;
  artist: string;
  searchKeyword: string;
  matchedSongId?: string;
  matchedSongName?: string;
  matchedArtists?: string[];
  matchScore?: number;
  source: string;
}

const MANUAL_ORIGINAL_ID_OVERRIDES: Record<string, string> = {
  "yellow::coldplay": "17177324",
  "love song::方大同": "82360",
};

function asString(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim();
}

function parseArgs(argv: string[]): FillArgs {
  const env = loadEnv();
  const args: FillArgs = {
    workbookPath: env.aotdWorkbookPath,
    dryRun: false,
    onlyPending: true,
    backup: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--workbook" && next) {
      args.workbookPath = next;
      index += 1;
      continue;
    }
    if (arg === "--limit" && next) {
      const limit = Number(next);
      if (Number.isFinite(limit) && limit > 0) {
        args.limit = limit;
      }
      index += 1;
      continue;
    }
    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (arg === "--all") {
      args.onlyPending = false;
      continue;
    }
    if (arg === "--no-backup") {
      args.backup = false;
    }
  }

  return args;
}

function shouldProcessRow(row: SongLibraryRow, onlyPending: boolean): boolean {
  const song = asString(row.Song);
  const artist = asString(row.Artist);
  if (!song || !artist) {
    return false;
  }

  if (!onlyPending) {
    return !asString(row.OriginalID);
  }

  const idStatus = asString(row.IDStatus).toLowerCase();
  return !asString(row.OriginalID) && (!idStatus || idStatus === "pending" || idStatus === "to review");
}

function buildBackupPath(workbookPath: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = path.extname(workbookPath);
  const base = workbookPath.slice(0, workbookPath.length - ext.length);
  return `${base}.backup-${timestamp}${ext}`;
}

function buildReportPath(workbookPath: string): string {
  const dir = path.dirname(workbookPath);
  const base = path.basename(workbookPath, path.extname(workbookPath));
  return path.join(dir, `${base}.original-id-report.json`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resolveWithRetry(
  title: string,
  artist: string,
  keyword: string,
  cache: Map<string, NeteaseTrackResolution>,
): Promise<NeteaseTrackResolution> {
  const cacheKey = `${title}::${artist}::${keyword}`.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const delays = [0, 700, 1400];
  let lastResolution: NeteaseTrackResolution | null = null;

  for (const delay of delays) {
    if (delay > 0) {
      await sleep(delay);
    }

    const resolution = await resolveNeteaseTrack({
      title,
      artist,
      keyword,
    });
    lastResolution = resolution;

    if (resolution.source === "search_match" || resolution.source === "original_id") {
      cache.set(cacheKey, resolution);
      return resolution;
    }
  }

  const fallback =
    lastResolution ||
    ({
      targetUrl: "https://music.163.com/",
      searchKeyword: keyword,
      source: "empty",
    } satisfies NeteaseTrackResolution);

  const manualOverrideKey = `${title}::${artist}`.toLowerCase();
  const manualOriginalId = MANUAL_ORIGINAL_ID_OVERRIDES[manualOverrideKey];
  if (manualOriginalId) {
    const manualResolution: NeteaseTrackResolution = {
      targetUrl: `https://music.163.com/#/song?id=${encodeURIComponent(manualOriginalId)}`,
      matchedSongId: manualOriginalId,
      matchedSongName: title,
      matchedArtistNames: [artist],
      searchKeyword: keyword,
      source: "search_match",
      matchScore: 999,
    };
    cache.set(cacheKey, manualResolution);
    return manualResolution;
  }

  cache.set(cacheKey, fallback);
  return fallback;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workbookPath = path.resolve(args.workbookPath);

  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Workbook not found: ${workbookPath}`);
  }

  const workbook = xlsx.readFile(workbookPath);
  const sheet = workbook.Sheets.SongLibrary;
  if (!sheet) {
    throw new Error("Workbook missing SongLibrary sheet.");
  }

  const rows = xlsx.utils.sheet_to_json<SongLibraryRow>(sheet, {
    defval: "",
    raw: false,
  });

  const candidates = rows.filter((row) => shouldProcessRow(row, args.onlyPending));
  const targetRows = typeof args.limit === "number" ? candidates.slice(0, args.limit) : candidates;

  const matched: FillReportItem[] = [];
  const unmatched: FillReportItem[] = [];
  const resolutionCache = new Map<string, NeteaseTrackResolution>();
  let updatedCount = 0;

  console.log(
    JSON.stringify(
      {
        workbookPath,
        totalRows: rows.length,
        candidateRows: candidates.length,
        processingRows: targetRows.length,
        dryRun: args.dryRun,
      },
      null,
      2,
    ),
  );

  for (const [index, row] of targetRows.entries()) {
    const song = asString(row.Song);
    const artist = asString(row.Artist);
    const searchKeyword = asString(row.CLIKeyword) || `${song} ${artist}`.trim();

    const resolution = await resolveWithRetry(song, artist, searchKeyword, resolutionCache);

    const reportItem: FillReportItem = {
      rowId: asString(row.ID),
      song,
      artist,
      searchKeyword: resolution.searchKeyword,
      matchedSongId: resolution.matchedSongId,
      matchedSongName: resolution.matchedSongName,
      matchedArtists: resolution.matchedArtistNames,
      matchScore: resolution.matchScore,
      source: resolution.source,
    };

    if (resolution.source === "search_match" && resolution.matchedSongId) {
      row.OriginalID = resolution.matchedSongId;
      row.IsPlayable = "Y";
      row.IDStatus = "Done";
      row.CLIKeyword = searchKeyword;
      row.ReviewStatus = asString(row.ReviewStatus) || "Auto Matched";
      matched.push(reportItem);
      updatedCount += 1;
    } else {
      unmatched.push(reportItem);
    }

    console.log(
      `[${index + 1}/${targetRows.length}] ${song} - ${artist} -> ${resolution.matchedSongId || "NO_MATCH"} (${resolution.source})`,
    );

    if (index < targetRows.length - 1) {
      await sleep(120);
    }
  }

  const report = {
    workbookPath,
    updatedCount,
    unmatchedCount: unmatched.length,
    matched,
    unmatched,
  };

  const reportPath = buildReportPath(workbookPath);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf-8");

  if (!args.dryRun && updatedCount > 0) {
    if (args.backup) {
      const backupPath = buildBackupPath(workbookPath);
      fs.copyFileSync(workbookPath, backupPath);
      console.log(`Backup created: ${backupPath}`);
    }

    const nextSheet = xlsx.utils.json_to_sheet(rows);
    workbook.Sheets.SongLibrary = nextSheet;
    xlsx.writeFile(workbook, workbookPath);
    console.log(`Workbook updated: ${workbookPath}`);
  } else if (args.dryRun) {
    console.log("Dry run only, workbook not modified.");
  } else {
    console.log("No rows updated, workbook unchanged.");
  }

  console.log(`Report written: ${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
