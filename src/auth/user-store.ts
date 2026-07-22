// 阶段 1 用进程内 Map 存 userId ↔ openid/nickname。
// 重启会丢；阶段 2 会换云数据库持久化（按 userId 存题目历史/答案历史/歌单历史/反馈日志）。
//
// 同一 openid 多次登录会复用同一个 userId，保证跨设备的记忆连续。

import { randomBytes } from "node:crypto";

export interface UserRecord {
  userId: string;
  openid?: string;
  nickname: string;
  createdAt: string;
  lastSeenAt: string;
  isAnonymous: boolean;
}

const ANON_PREFIX = "anon-";
const WX_PREFIX = "wx-";

class UserStore {
  private byUserId = new Map<string, UserRecord>();
  private openidIndex = new Map<string, string>();

  getUserCount(): number {
    return this.byUserId.size;
  }

  get(userId: string): UserRecord | undefined {
    return this.byUserId.get(userId);
  }

  getByOpenid(openid: string): UserRecord | undefined {
    const userId = this.openidIndex.get(openid);
    if (!userId) return undefined;
    return this.byUserId.get(userId);
  }

  upsertByOpenid(openid: string, nickname?: string): UserRecord {
    const existing = this.getByOpenid(openid);
    if (existing) {
      existing.lastSeenAt = new Date().toISOString();
      if (nickname && nickname !== "朋友") {
        existing.nickname = nickname;
      }
      return existing;
    }
    const record: UserRecord = {
      userId: `${WX_PREFIX}${randomBytes(8).toString("hex")}`,
      openid,
      nickname: nickname || "朋友",
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      isAnonymous: false,
    };
    this.byUserId.set(record.userId, record);
    this.openidIndex.set(openid, record.userId);
    return record;
  }

  createAnonymous(): UserRecord {
    const record: UserRecord = {
      userId: `${ANON_PREFIX}${randomBytes(10).toString("hex")}`,
      nickname: "朋友",
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      isAnonymous: true,
    };
    this.byUserId.set(record.userId, record);
    return record;
  }

  touch(userId: string): UserRecord | undefined {
    const record = this.byUserId.get(userId);
    if (!record) return undefined;
    record.lastSeenAt = new Date().toISOString();
    return record;
  }
}

export const userStore = new UserStore();
