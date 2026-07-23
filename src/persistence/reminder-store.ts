import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import { getMysqlPool } from "./mysql.js";

export interface EveningReminderRecord {
  id: number;
  userId: string;
  openid: string;
  templateId: string;
  pagePath: string;
  remindAt: string;
  status: "pending" | "sending" | "sent" | "failed";
  sendAttempts: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
}

interface ReminderRow extends RowDataPacket {
  id: number;
  user_id: string;
  openid: string;
  template_id: string;
  page_path: string;
  remind_at: Date | string;
  status: "pending" | "sending" | "sent" | "failed";
  send_attempts: number;
  last_error: string | null;
  sent_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
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

function toReminderRecord(row: ReminderRow): EveningReminderRecord {
  return {
    id: row.id,
    userId: row.user_id,
    openid: row.openid,
    templateId: row.template_id,
    pagePath: row.page_path,
    remindAt: new Date(row.remind_at).toISOString(),
    status: row.status,
    sendAttempts: Number(row.send_attempts || 0),
    lastError: row.last_error || undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    sentAt: toIso(row.sent_at),
  };
}

export class ReminderStore {
  private schemaReady: Promise<void> | null = null;

  private get pool(): Pool | null {
    return getMysqlPool();
  }

  async ensureSchema(): Promise<void> {
    if (!this.pool) return;
    if (!this.schemaReady) {
      this.schemaReady = (async () => {
        await this.pool!.query(`
          CREATE TABLE IF NOT EXISTS aotd_evening_reminder (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user_id VARCHAR(64) NOT NULL,
            openid VARCHAR(128) NOT NULL,
            template_id VARCHAR(128) NOT NULL,
            page_path VARCHAR(255) NOT NULL DEFAULT 'pages/landing/index',
            remind_at DATETIME NOT NULL,
            status ENUM('pending','sending','sent','failed') NOT NULL DEFAULT 'pending',
            send_attempts INT NOT NULL DEFAULT 0,
            last_error TEXT NULL,
            sent_at DATETIME NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            INDEX idx_status_remind_at (status, remind_at),
            INDEX idx_user_id (user_id)
          ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        `);
      })();
    }
    await this.schemaReady;
  }

  async scheduleReminder(params: {
    userId: string;
    openid: string;
    templateId: string;
    pagePath: string;
    remindAt: Date;
  }): Promise<EveningReminderRecord | null> {
    if (!this.pool) return null;
    await this.ensureSchema();
    const remindAt = params.remindAt.toISOString().slice(0, 19).replace("T", " ");
    const timestamp = nowSql();
    await this.pool.query(
      `
        DELETE FROM aotd_evening_reminder
        WHERE user_id = ? AND template_id = ? AND status IN ('pending', 'sending')
      `,
      [params.userId, params.templateId],
    );
    const [result] = await this.pool.query<ResultSetHeader>(
      `
        INSERT INTO aotd_evening_reminder (
          user_id, openid, template_id, page_path, remind_at,
          status, send_attempts, last_error, sent_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, ?)
      `,
      [params.userId, params.openid, params.templateId, params.pagePath, remindAt, timestamp, timestamp],
    );
    return this.findById(result.insertId);
  }

  async findLatestActiveReminder(userId: string, templateId: string): Promise<EveningReminderRecord | null> {
    if (!this.pool || !userId || !templateId) return null;
    await this.ensureSchema();
    const [rows] = await this.pool.query<ReminderRow[]>(
      `
        SELECT * FROM aotd_evening_reminder
        WHERE user_id = ? AND template_id = ? AND status IN ('pending', 'sending')
        ORDER BY remind_at DESC
        LIMIT 1
      `,
      [userId, templateId],
    );
    return rows[0] ? toReminderRecord(rows[0]) : null;
  }

  async findDuePending(limit = 50): Promise<EveningReminderRecord[]> {
    if (!this.pool) return [];
    await this.ensureSchema();
    const [rows] = await this.pool.query<ReminderRow[]>(
      `
        SELECT * FROM aotd_evening_reminder
        WHERE status = 'pending' AND remind_at <= ?
        ORDER BY remind_at ASC, id ASC
        LIMIT ?
      `,
      [nowSql(), limit],
    );
    return rows.map(toReminderRecord);
  }

  async claimReminder(id: number): Promise<boolean> {
    if (!this.pool || !id) return false;
    await this.ensureSchema();
    const [result] = await this.pool.query<ResultSetHeader>(
      `
        UPDATE aotd_evening_reminder
        SET status = 'sending', updated_at = ?
        WHERE id = ? AND status = 'pending'
      `,
      [nowSql(), id],
    );
    return result.affectedRows === 1;
  }

  async markSent(id: number): Promise<void> {
    if (!this.pool || !id) return;
    await this.ensureSchema();
    await this.pool.query(
      `
        UPDATE aotd_evening_reminder
        SET status = 'sent', send_attempts = send_attempts + 1, sent_at = ?, updated_at = ?, last_error = NULL
        WHERE id = ?
      `,
      [nowSql(), nowSql(), id],
    );
  }

  async markFailed(id: number, errorMessage: string): Promise<void> {
    if (!this.pool || !id) return;
    await this.ensureSchema();
    await this.pool.query(
      `
        UPDATE aotd_evening_reminder
        SET status = 'failed', send_attempts = send_attempts + 1, last_error = ?, updated_at = ?
        WHERE id = ?
      `,
      [errorMessage.slice(0, 1000), nowSql(), id],
    );
  }

  private async findById(id: number): Promise<EveningReminderRecord | null> {
    if (!this.pool || !id) return null;
    await this.ensureSchema();
    const [rows] = await this.pool.query<ReminderRow[]>("SELECT * FROM aotd_evening_reminder WHERE id = ? LIMIT 1", [id]);
    return rows[0] ? toReminderRecord(rows[0]) : null;
  }
}

export const reminderStore = new ReminderStore();
