import "dotenv/config";

export interface AppEnv {
  openaiApiKey?: string;
  openaiModel?: string;
  openaiBaseUrl: string;
  aotdSongProvider: string;
  aotdSongApiKey: string;
  aotdSongBaseUrl: string;
  aotdSongModel: string;
  aotdSongCreatePath: string;
  aotdSongUploadCreatePath: string;
  aotdSongStatusPath: string;
  aotdSongCallbackUrl: string;
  aotdSongWebhookSecret: string;
  aotdPublicBaseUrl: string;
  aotdSongVoicePersonaId: string;
  aotdSongVoicePersonaModel: string;
  aotdWorkbookPath: string;
  wxAppId: string;
  wxSecret: string;
  reminderWorkerToken: string;
  mysqlAddress: string;
  mysqlUsername: string;
  mysqlPassword: string;
  mysqlDatabase: string;
}

export function loadEnv(): AppEnv {
  const workbookPath =
    process.env.AOTD_WORKBOOK_PATH ||
    process.env.WORKBOOK_PATH ||
    "data/AOTD_500_Song_Library_Enhanced.xlsx";

  return {
    openaiApiKey: process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY,
    openaiModel:
      process.env.OPENAI_MODEL || process.env.ANTHROPIC_MODEL || "gpt-4o-mini",
    openaiBaseUrl:
      process.env.OPENAI_BASE_URL || process.env.OPENAI_BASEURL || "https://api.openai.com/v1",
    aotdSongProvider: process.env.AOTD_SONG_PROVIDER || "demo",
    aotdSongApiKey: process.env.AOTD_SONG_API_KEY || "",
    aotdSongBaseUrl: process.env.AOTD_SONG_BASE_URL || "https://api.sunoapi.org",
    aotdSongModel: process.env.AOTD_SONG_MODEL || "V4_5ALL",
    aotdSongCreatePath: process.env.AOTD_SONG_CREATE_PATH || "/api/v1/generate",
    aotdSongUploadCreatePath: process.env.AOTD_SONG_UPLOAD_CREATE_PATH || "/api/v1/generate/upload-cover",
    aotdSongStatusPath: process.env.AOTD_SONG_STATUS_PATH || "/api/v1/generate/record-info?taskId={taskId}",
    aotdSongCallbackUrl: process.env.AOTD_SONG_CALLBACK_URL || "",
    aotdSongWebhookSecret: process.env.AOTD_SONG_WEBHOOK_SECRET || "",
    aotdPublicBaseUrl: process.env.AOTD_PUBLIC_BASE_URL || "",
    aotdSongVoicePersonaId: process.env.AOTD_SONG_VOICE_PERSONA_ID || "",
    aotdSongVoicePersonaModel: process.env.AOTD_SONG_VOICE_PERSONA_MODEL || "",
    aotdWorkbookPath: workbookPath,
    wxAppId: process.env.WX_APPID || "",
    wxSecret: process.env.WX_SECRET || "",
    reminderWorkerToken: process.env.AOTD_REMINDER_WORKER_TOKEN || "",
    mysqlAddress: process.env.MYSQL_ADDRESS || "",
    mysqlUsername: process.env.MYSQL_USERNAME || "",
    mysqlPassword: process.env.MYSQL_PASSWORD || "",
    mysqlDatabase: process.env.MYSQL_DATABASE || "mysql",
  };
}
