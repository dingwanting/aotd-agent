import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { getMysqlPool } from "./mysql.js";

export type AotdSongTaskStatus = "pending" | "processing" | "completed" | "failed";

export interface AotdSongTaskRecord {
  id: number;
  userId: string;
  titleText: string;
  playlistTitle: string;
  tracksJson: string;
  voiceBase64: string;
  voiceFormat: string;
  voicePersonaId?: string;
  status: AotdSongTaskStatus;
  providerMode: string;
  songTitle?: string;
  songSummary?: string;
  songDurationSeconds?: number;
  songAudioPath?: string;
  songVoiceSamplePath?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

interface AotdSongTaskRow extends RowDataPacket {
  id: number;
  user_id: string;
  title_text: string;
  playlist_title: string;
  tracks_json: string;
  voice_base64: string;
  voice_format: string;
  voice_persona_id: string | null;
  status: AotdSongTaskStatus;
  provider_mode: string;
  song_title: string | null;
  song_summary: string | null;
  song_duration_seconds: number | null;
  song_audio_path: string | null;
  song_voice_sample_path: string | null;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
}

function nowSql(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function toIso(value: Date | string | null): string | undefined {
  if (!value) {
    return undefined;
  }
  return new Date(value).toISOString();
}

function toTaskRecord(row: AotdSongTaskRow): AotdSongTaskRecord {
  return {
    id: row.id,
    userId: row.user_id,
    titleText: row.title_text,
    playlistTitle: row.playlist_title,
    tracksJson: row.tracks_json,
    voiceBase64: row.voice_base64,
    voiceFormat: row.voice_format,
    voicePersonaId: row.voice_persona_id || undefined,
    status: row.status,
    providerMode: row.provider_mode,
    songTitle: row.song_title || undefined,
    songSummary: row.song_summary || undefined,
    songDurationSeconds:
      row.song_duration_seconds === null || row.song_duration_seconds === undefined
        ? undefined
        : Number(row.song_duration_seconds),
    songAudioPath: row.song_audio_path || undefined,
    songVoiceSamplePath: row.song_voice_sample_path || undefined,
    errorMessage: row.error_message || undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    completedAt: toIso(row.completed_at),
  };
}

interface CreateTaskParams {
  userId: string;
  titleText: string;
  playlistTitle: string;
  tracksJson: string;
  voiceBase64: string;
  voiceFormat: string;
  voicePersonaId?: string;
  providerMode: string;
}

interface MarkCompletedParams {
  providerMode: string;
  songTitle: string;
  songSummary: string;
  songDurationSeconds: number;
  songAudioPath: string;
  songVoiceSamplePath?: string;
}

export class AotdSongStore {
  private schemaReady: Promise<void> | null = null;
  private memoryId = 1;
  private readonly memoryTasks = new Map<number, AotdSongTaskRecord>();

  private get pool(): Pool | null {
    return getMysqlPool();
  }

  async ensureSchema(): Promise<void> {
    if (!this.pool) {
      return;
    }
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.pool!.query(`
          CREATE TABLE IF NOT EXISTS aotd_song_task (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(64) NOT NULL,
            title_text VARCHAR(255) NOT NULL,
            playlist_title VARCHAR(255) NOT NULL,
            tracks_json JSON NOT NULL,
            voice_base64 LONGTEXT NOT NULL,
            voice_format VARCHAR(32) NOT NULL DEFAULT 'mp3',
            voice_persona_id VARCHAR(255) NULL,
            status ENUM('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
            provider_mode VARCHAR(64) NOT NULL DEFAULT 'demo',
            song_title VARCHAR(255) NULL,
            song_summary TEXT NULL,
            song_duration_seconds INT NULL,
            song_audio_path VARCHAR(500) NULL,
            song_voice_sample_path VARCHAR(500) NULL,
            error_message TEXT NULL,
            completed_at DATETIME NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            INDEX idx_user_id_created_at (user_id, created_at),
            INDEX idx_status_created_at (status, created_at)
          ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        `);
        await this.pool!.query(`
          ALTER TABLE aotd_song_task
          ADD COLUMN voice_persona_id VARCHAR(255) NULL AFTER voice_format
        `).catch(() => undefined);
      })();
    }
    await this.schemaReady;
  }

  async createTask(params: CreateTaskParams): Promise<AotdSongTaskRecord> {
    if (!this.pool) {
      const task: AotdSongTaskRecord = {
        id: this.memoryId++,
        userId: params.userId,
        titleText: params.titleText,
        playlistTitle: params.playlistTitle,
        tracksJson: params.tracksJson,
        voiceBase64: params.voiceBase64,
        voiceFormat: params.voiceFormat,
        voicePersonaId: params.voicePersonaId,
        status: "pending",
        providerMode: params.providerMode,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.memoryTasks.set(task.id, task);
      return task;
    }

    await this.ensureSchema();
    const timestamp = nowSql();
    const [result] = await this.pool.query<ResultSetHeader>(
      `
        INSERT INTO aotd_song_task (
          user_id, title_text, playlist_title, tracks_json, voice_base64, voice_format, voice_persona_id,
          status, provider_mode, song_title, song_summary, song_duration_seconds,
          song_audio_path, song_voice_sample_path, error_message, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
      `,
      [
        params.userId,
        params.titleText,
        params.playlistTitle,
        params.tracksJson,
        params.voiceBase64,
        params.voiceFormat,
        params.voicePersonaId || null,
        params.providerMode,
        timestamp,
        timestamp,
      ],
    );
    return (await this.findById(result.insertId)) as AotdSongTaskRecord;
  }

  async findById(id: number): Promise<AotdSongTaskRecord | null> {
    if (!id) {
      return null;
    }
    if (!this.pool) {
      return this.memoryTasks.get(id) || null;
    }
    await this.ensureSchema();
    const [rows] = await this.pool.query<AotdSongTaskRow[]>("SELECT * FROM aotd_song_task WHERE id = ? LIMIT 1", [id]);
    return rows[0] ? toTaskRecord(rows[0]) : null;
  }

  async claimTask(id: number): Promise<boolean> {
    if (!id) {
      return false;
    }
    if (!this.pool) {
      const task = this.memoryTasks.get(id);
      if (!task || task.status !== "pending") {
        return false;
      }
      task.status = "processing";
      task.updatedAt = new Date().toISOString();
      this.memoryTasks.set(id, task);
      return true;
    }
    await this.ensureSchema();
    const [result] = await this.pool.query<ResultSetHeader>(
      `
        UPDATE aotd_song_task
        SET status = 'processing', updated_at = ?
        WHERE id = ? AND status = 'pending'
      `,
      [nowSql(), id],
    );
    return result.affectedRows === 1;
  }

  async markCompleted(id: number, params: MarkCompletedParams): Promise<void> {
    if (!id) {
      return;
    }
    if (!this.pool) {
      const task = this.memoryTasks.get(id);
      if (!task) {
        return;
      }
      task.status = "completed";
      task.providerMode = params.providerMode;
      task.songTitle = params.songTitle;
      task.songSummary = params.songSummary;
      task.songDurationSeconds = params.songDurationSeconds;
      task.songAudioPath = params.songAudioPath;
      task.songVoiceSamplePath = params.songVoiceSamplePath;
      task.errorMessage = undefined;
      task.updatedAt = new Date().toISOString();
      task.completedAt = new Date().toISOString();
      this.memoryTasks.set(id, task);
      return;
    }
    await this.ensureSchema();
    const timestamp = nowSql();
    await this.pool.query(
      `
        UPDATE aotd_song_task
        SET status = 'completed',
            provider_mode = ?,
            song_title = ?,
            song_summary = ?,
            song_duration_seconds = ?,
            song_audio_path = ?,
            song_voice_sample_path = ?,
            error_message = NULL,
            completed_at = ?,
            updated_at = ?
        WHERE id = ?
      `,
      [
        params.providerMode,
        params.songTitle,
        params.songSummary,
        params.songDurationSeconds,
        params.songAudioPath,
        params.songVoiceSamplePath || null,
        timestamp,
        timestamp,
        id,
      ],
    );
  }

  async markFailed(id: number, errorMessage: string): Promise<void> {
    if (!id) {
      return;
    }
    if (!this.pool) {
      const task = this.memoryTasks.get(id);
      if (!task) {
        return;
      }
      task.status = "failed";
      task.errorMessage = errorMessage.slice(0, 1000);
      task.updatedAt = new Date().toISOString();
      this.memoryTasks.set(id, task);
      return;
    }
    await this.ensureSchema();
    await this.pool.query(
      `
        UPDATE aotd_song_task
        SET status = 'failed', error_message = ?, updated_at = ?
        WHERE id = ?
      `,
      [errorMessage.slice(0, 1000), nowSql(), id],
    );
  }
}

export const aotdSongStore = new AotdSongStore();
