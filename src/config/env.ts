import "dotenv/config";

export interface AppEnv {
  openaiApiKey?: string;
  openaiModel?: string;
  openaiBaseUrl: string;
  aotdWorkbookPath: string;
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
    aotdWorkbookPath: workbookPath,
  };
}
