import { loadEnv } from "../config/env.js";
import { AotdPlanner } from "../domain/aotd/planner.js";
import { buildAotdAnalysis, buildAotdPlaylist, buildAotdShareCard } from "../domain/aotd/playlist-builder.js";
import { AotdRetriever } from "../domain/aotd/retriever.js";
import type { AotdQuestionnaireAnswers, AotdResponse } from "../domain/aotd/types.js";
import { loadSongsFromWorkbook } from "../domain/aotd/workbook-loader.js";
import { OpenAICompatibleClient } from "../providers/openai-compatible.js";

export interface AotdRunOptions {
  excludeSongIds?: string[];
  excludeSongKeys?: string[];
  rotationSeed?: number | string;
}

export class AotdAgent {
  async run(answers: AotdQuestionnaireAnswers, options?: AotdRunOptions): Promise<AotdResponse> {
    const env = loadEnv();
    const client = new OpenAICompatibleClient({
      apiKey: env.openaiApiKey,
      model: env.openaiModel || "gpt-4o-mini",
      baseUrl: env.openaiBaseUrl,
    });

    const planner = new AotdPlanner(client);
    const plan = await planner.plan({ answers });
    const catalog = loadSongsFromWorkbook(env.aotdWorkbookPath);
    const retriever = new AotdRetriever(catalog);
    const rotationSeed = options?.rotationSeed ?? Date.now();
    // 取 12 个候选，让 retriever 在多样化重排后能稳定挑出 5 首不重复的
    const candidates = retriever.retrieve(plan, 12, {
      excludeSongIds: options?.excludeSongIds,
      excludeSongKeys: options?.excludeSongKeys,
      rotationSeed,
    });
    const analysis = buildAotdAnalysis(plan);
    const playlist = buildAotdPlaylist(plan, candidates);
    const shareCard = buildAotdShareCard(answers, plan, playlist);

    return {
      answers,
      plan,
      analysis,
      playlist,
      candidates,
      shareCard,
    };
  }
}
