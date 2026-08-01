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

interface AotdAgentSharedResources {
  signature: string;
  planner: AotdPlanner;
  retriever: AotdRetriever;
}

let sharedResources: AotdAgentSharedResources | null = null;

function buildSharedSignature() {
  const env = loadEnv();
  return JSON.stringify({
    workbookPath: env.aotdWorkbookPath,
    openaiModel: env.openaiModel || "gpt-4o-mini",
    openaiBaseUrl: env.openaiBaseUrl,
    hasApiKey: Boolean(env.openaiApiKey),
  });
}

function createSharedResources(): AotdAgentSharedResources {
  const env = loadEnv();
  const client = new OpenAICompatibleClient({
    apiKey: env.openaiApiKey,
    model: env.openaiModel || "gpt-4o-mini",
    baseUrl: env.openaiBaseUrl,
  });
  const planner = new AotdPlanner(client);
  const catalog = loadSongsFromWorkbook(env.aotdWorkbookPath);
  const retriever = new AotdRetriever(catalog);
  return {
    signature: buildSharedSignature(),
    planner,
    retriever,
  };
}

function getSharedResources(): AotdAgentSharedResources {
  const nextSignature = buildSharedSignature();
  if (!sharedResources || sharedResources.signature !== nextSignature) {
    sharedResources = createSharedResources();
  }
  return sharedResources;
}

export class AotdAgent {
  private readonly shared: AotdAgentSharedResources;

  constructor() {
    this.shared = getSharedResources();
  }

  static preload(): void {
    getSharedResources();
  }

  async run(answers: AotdQuestionnaireAnswers, options?: AotdRunOptions): Promise<AotdResponse> {
    const plan = await this.shared.planner.plan({ answers });
    const rotationSeed = options?.rotationSeed ?? Date.now();
    // 取 12 个候选，让 retriever 在多样化重排后能稳定挑出 5 首不重复的
    const candidates = this.shared.retriever.retrieve(plan, 12, {
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
