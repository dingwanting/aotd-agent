import type { Pool, RowDataPacket } from "mysql2/promise";

import type { AotdQuestionnaireAnswers, AotdResponse } from "../domain/aotd/types.js";
import { getMysqlPool } from "./mysql.js";

const QUESTION_HISTORY_LIMIT = 4;
const PLAYLIST_HISTORY_LIMIT = 6;
const ANSWER_HISTORY_LIMIT = 8;
const EVENT_LOG_LIMIT = 60;
const FALLBACK_NICKNAME = "朋友";

export interface UserProfileRecord {
  userId: string;
  openid?: string;
  nickname: string;
  isAnonymous: boolean;
  createdAt: string;
  lastSeenAt: string;
}

export interface QuestionDeckIds {
  consumptionSource?: string;
  emotionalNeed?: string;
  emotionalImagery?: string;
}

export interface UserMemorySnapshot {
  questionDeckHistory: Record<string, string[]>;
  playlistHistory: Array<{
    answers: AotdQuestionnaireAnswers;
    playlist: AotdResponse["playlist"];
  }>;
  answerHistory: Array<{
    answers: AotdQuestionnaireAnswers;
    result: AotdResponse;
    reusedAt?: string;
  }>;
  eventLog: Array<Record<string, unknown>>;
}

type AnswerHistoryEntry = UserMemorySnapshot["answerHistory"][number];
type EventLogEntry = { createdAt: string } & Record<string, unknown>;

interface UserStateRow extends RowDataPacket {
  user_id: string;
  openid: string | null;
  nickname: string;
  is_anonymous: number;
  question_history_json: string;
  playlist_history_json: string;
  answer_history_json: string;
  event_log_json: string;
  created_at: Date | string;
  updated_at: Date | string;
  last_seen_at: Date | string;
}

function nowSql(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function safeParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeQuestionHistory(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const record = value as Record<string, unknown>;
  const result: Record<string, string[]> = {};
  ["consumptionSource", "emotionalNeed", "emotionalImagery"].forEach((key) => {
    const current = record[key];
    result[key] = Array.isArray(current) ? current.filter((item): item is string => typeof item === "string").slice(0, QUESTION_HISTORY_LIMIT) : [];
  });
  return result;
}

function normalizePlaylistHistory(value: unknown): UserMemorySnapshot["playlistHistory"] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is UserMemorySnapshot["playlistHistory"][number] =>
          Boolean(item) &&
          typeof item === "object" &&
          Boolean((item as { answers?: unknown }).answers) &&
          Boolean((item as { playlist?: unknown }).playlist),
      ).slice(0, PLAYLIST_HISTORY_LIMIT)
    : [];
}

function normalizeAnswerHistory(value: unknown): UserMemorySnapshot["answerHistory"] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is UserMemorySnapshot["answerHistory"][number] =>
          Boolean(item) &&
          typeof item === "object" &&
          Boolean((item as { answers?: unknown }).answers) &&
          Boolean((item as { result?: unknown }).result),
      ).slice(0, ANSWER_HISTORY_LIMIT)
    : [];
}

function normalizeEventLog(value: unknown): UserMemorySnapshot["eventLog"] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object").slice(0, EVENT_LOG_LIMIT)
    : [];
}

function defaultMemorySnapshot(): UserMemorySnapshot {
  return {
    questionDeckHistory: {
      consumptionSource: [],
      emotionalNeed: [],
      emotionalImagery: [],
    },
    playlistHistory: [],
    answerHistory: [],
    eventLog: [],
  };
}

function toProfile(row: UserStateRow): UserProfileRecord {
  return {
    userId: row.user_id,
    openid: row.openid || undefined,
    nickname: row.nickname || FALLBACK_NICKNAME,
    isAnonymous: Boolean(row.is_anonymous),
    createdAt: new Date(row.created_at).toISOString(),
    lastSeenAt: new Date(row.last_seen_at).toISOString(),
  };
}

function toMemory(row: UserStateRow): UserMemorySnapshot {
  return {
    questionDeckHistory: normalizeQuestionHistory(safeParse(row.question_history_json, {})),
    playlistHistory: normalizePlaylistHistory(safeParse(row.playlist_history_json, [])),
    answerHistory: normalizeAnswerHistory(safeParse(row.answer_history_json, [])),
    eventLog: normalizeEventLog(safeParse(row.event_log_json, [])),
  };
}

function isSameAnswers(left: AotdQuestionnaireAnswers, right: AotdQuestionnaireAnswers): boolean {
  return (
    left.consumptionSource === right.consumptionSource &&
    left.emotionalNeed === right.emotionalNeed &&
    left.emotionalImagery === right.emotionalImagery
  );
}

function updateQuestionHistory(history: Record<string, string[]>, deckIds?: QuestionDeckIds): Record<string, string[]> {
  const next = normalizeQuestionHistory(history);
  if (!deckIds) return next;
  (Object.keys(next) as Array<keyof QuestionDeckIds>).forEach((key) => {
    const deckId = deckIds[key];
    if (!deckId) return;
    next[key] = [deckId].concat(next[key].filter((item) => item !== deckId)).slice(0, QUESTION_HISTORY_LIMIT);
  });
  return next;
}

function buildSongKey(song: { title?: string; artist?: string } | undefined): string {
  return song?.title && song?.artist ? `${song.title}::${song.artist}` : "";
}

function collectRecentExclusions(history: UserMemorySnapshot["playlistHistory"]): { excludeSongIds: string[]; excludeSongKeys: string[] } {
  const excludeSongIds: string[] = [];
  const excludeSongKeys: string[] = [];
  history.slice(0, PLAYLIST_HISTORY_LIMIT).forEach((item) => {
    item.playlist.tracks.forEach((track) => {
      if (track.song?.id) excludeSongIds.push(track.song.id);
      const key = buildSongKey(track.song);
      if (key) excludeSongKeys.push(key);
    });
  });
  return {
    excludeSongIds: [...new Set(excludeSongIds)],
    excludeSongKeys: [...new Set(excludeSongKeys)],
  };
}

export class UserStateStore {
  private schemaReady: Promise<void> | null = null;

  private get pool(): Pool | null {
    return getMysqlPool();
  }

  async isEnabled(): Promise<boolean> {
    return Boolean(this.pool);
  }

  async ensureSchema(): Promise<void> {
    if (!this.pool) return;
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.pool!.query(`
          CREATE TABLE IF NOT EXISTS aotd_user_state (
            user_id VARCHAR(64) PRIMARY KEY,
            openid VARCHAR(128) UNIQUE NULL,
            nickname VARCHAR(128) NOT NULL DEFAULT '朋友',
            is_anonymous TINYINT(1) NOT NULL DEFAULT 1,
            question_history_json LONGTEXT NOT NULL,
            playlist_history_json LONGTEXT NOT NULL,
            answer_history_json LONGTEXT NOT NULL,
            event_log_json LONGTEXT NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            last_seen_at DATETIME NOT NULL
          ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        `);
      })();
    }
    await this.schemaReady;
  }

  async countUsers(): Promise<number> {
    if (!this.pool) return 0;
    await this.ensureSchema();
    const [rows] = await this.pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM aotd_user_state");
    return Number(rows[0]?.total || 0);
  }

  async findByUserId(userId: string): Promise<{ profile: UserProfileRecord; memory: UserMemorySnapshot } | null> {
    if (!this.pool || !userId) return null;
    await this.ensureSchema();
    const [rows] = await this.pool.query<UserStateRow[]>("SELECT * FROM aotd_user_state WHERE user_id = ? LIMIT 1", [userId]);
    const row = rows[0];
    if (!row) return null;
    return { profile: toProfile(row), memory: toMemory(row) };
  }

  async findByOpenid(openid: string): Promise<{ profile: UserProfileRecord; memory: UserMemorySnapshot } | null> {
    if (!this.pool || !openid) return null;
    await this.ensureSchema();
    const [rows] = await this.pool.query<UserStateRow[]>("SELECT * FROM aotd_user_state WHERE openid = ? LIMIT 1", [openid]);
    const row = rows[0];
    if (!row) return null;
    return { profile: toProfile(row), memory: toMemory(row) };
  }

  async saveUser(profile: UserProfileRecord): Promise<void> {
    if (!this.pool) return;
    await this.ensureSchema();
    const timestamp = nowSql();
    const existing = await this.findByUserId(profile.userId);
    const memory = existing?.memory || defaultMemorySnapshot();
    await this.pool.query(
      `
        INSERT INTO aotd_user_state (
          user_id, openid, nickname, is_anonymous,
          question_history_json, playlist_history_json, answer_history_json, event_log_json,
          created_at, updated_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          openid = VALUES(openid),
          nickname = VALUES(nickname),
          is_anonymous = VALUES(is_anonymous),
          updated_at = VALUES(updated_at),
          last_seen_at = VALUES(last_seen_at)
      `,
      [
        profile.userId,
        profile.openid || null,
        profile.nickname || FALLBACK_NICKNAME,
        profile.isAnonymous ? 1 : 0,
        JSON.stringify(memory.questionDeckHistory),
        JSON.stringify(memory.playlistHistory),
        JSON.stringify(memory.answerHistory),
        JSON.stringify(memory.eventLog),
        existing?.profile.createdAt ? existing.profile.createdAt.slice(0, 19).replace("T", " ") : timestamp,
        timestamp,
        timestamp,
      ],
    );
  }

  async touchUser(userId: string): Promise<void> {
    if (!this.pool || !userId) return;
    await this.ensureSchema();
    await this.pool.query("UPDATE aotd_user_state SET last_seen_at = ?, updated_at = ? WHERE user_id = ?", [nowSql(), nowSql(), userId]);
  }

  async updateNickname(userId: string, nickname: string): Promise<{ profile: UserProfileRecord; memory: UserMemorySnapshot } | null> {
    if (!this.pool || !userId || !nickname) return this.findByUserId(userId);
    await this.ensureSchema();
    await this.pool.query("UPDATE aotd_user_state SET nickname = ?, updated_at = ?, last_seen_at = ? WHERE user_id = ?", [
      nickname,
      nowSql(),
      nowSql(),
      userId,
    ]);
    return this.findByUserId(userId);
  }

  async getMemory(userId: string): Promise<UserMemorySnapshot> {
    const existing = await this.findByUserId(userId);
    return existing?.memory || defaultMemorySnapshot();
  }

  async findCachedResult(userId: string, answers: AotdQuestionnaireAnswers): Promise<AotdResponse | null> {
    const memory = await this.getMemory(userId);
    const hit = memory.answerHistory.find((item) => isSameAnswers(item.answers, answers));
    return hit ? hit.result : null;
  }

  async getRecentExclusions(userId: string): Promise<{ excludeSongIds: string[]; excludeSongKeys: string[] }> {
    const memory = await this.getMemory(userId);
    return collectRecentExclusions(memory.playlistHistory);
  }

  async saveRecommendation(params: {
    userId: string;
    answers: AotdQuestionnaireAnswers;
    result: AotdResponse;
    questionDeckIds?: QuestionDeckIds;
    reusedFromHistory?: boolean;
  }): Promise<UserMemorySnapshot> {
    const { userId, answers, result, questionDeckIds, reusedFromHistory } = params;
    if (!this.pool || !userId) return defaultMemorySnapshot();
    await this.ensureSchema();
    const existing = await this.getMemory(userId);
    const nextQuestionHistory = updateQuestionHistory(existing.questionDeckHistory, questionDeckIds);
    const playlistEntry = {
      answers,
      playlist: result.playlist,
    };
    const nextPlaylistHistory = [playlistEntry, ...existing.playlistHistory.filter((item) => !isSameAnswers(item.answers, answers))].slice(
      0,
      PLAYLIST_HISTORY_LIMIT,
    );
    const nextAnswerHistory: AnswerHistoryEntry[] = [
      {
        answers,
        result,
        reusedAt: reusedFromHistory ? new Date().toISOString() : undefined,
      },
      ...existing.answerHistory.filter((item) => !isSameAnswers(item.answers, answers)),
    ].slice(0, ANSWER_HISTORY_LIMIT);
    const nextMemory: UserMemorySnapshot = {
      questionDeckHistory: nextQuestionHistory,
      playlistHistory: nextPlaylistHistory,
      answerHistory: nextAnswerHistory,
      eventLog: existing.eventLog,
    };
    await this.pool.query(
      `
        UPDATE aotd_user_state
        SET question_history_json = ?, playlist_history_json = ?, answer_history_json = ?, updated_at = ?, last_seen_at = ?
        WHERE user_id = ?
      `,
      [
        JSON.stringify(nextMemory.questionDeckHistory),
        JSON.stringify(nextMemory.playlistHistory),
        JSON.stringify(nextMemory.answerHistory),
        nowSql(),
        nowSql(),
        userId,
      ],
    );
    return nextMemory;
  }

  async appendEvent(userId: string, event: Record<string, unknown>): Promise<void> {
    if (!this.pool || !userId) return;
    await this.ensureSchema();
    const existing = await this.getMemory(userId);
    const nextEventLog: EventLogEntry[] = [
      Object.assign(
        {
          createdAt: new Date().toISOString(),
        },
        event,
      ) as EventLogEntry,
      ...existing.eventLog.map((item) => ({
        createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
        ...item,
      })),
    ].slice(0, EVENT_LOG_LIMIT);
    await this.pool.query(
      "UPDATE aotd_user_state SET event_log_json = ?, updated_at = ?, last_seen_at = ? WHERE user_id = ?",
      [JSON.stringify(nextEventLog), nowSql(), nowSql(), userId],
    );
  }
}

export const userStateStore = new UserStateStore();
