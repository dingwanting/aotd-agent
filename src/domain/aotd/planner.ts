import { z } from "zod";

import type { AotdPlan, AotdRequest } from "./types.js";
import { renderQuestionnaireAnswers } from "./questionnaire.js";
import { aotdFewShotExamples } from "./few-shot-examples.js";
import { buildFewShotMessages } from "../../prompts/few-shot.js";
import { buildAotdSystemPrompt } from "../../prompts/system.js";
import { ClaudeStyleAgentRuntime } from "../../core/runtime.js";
import type { LLMClient } from "../../core/types.js";

const AotdPlanSchema = z.object({
  consumptionSource: z.string(),
  emotionalNeed: z.string(),
  emotionalImagery: z.string(),
  userIntent: z.string(),
  todayStateSummary: z.string(),
  moodSignals: z.array(z.string()),
  sceneSignals: z.array(z.string()),
  objectiveSignals: z.array(z.string()),
  constraints: z.array(z.string()),
  playlistStrategy: z.string(),
  queryHints: z.array(z.string()),
  explanationStyle: z.string(),
  uncertainty: z.array(z.string()),
});

function buildFallbackPlan(request: AotdRequest, reason: string): AotdPlan {
  const { answers } = request;

  return {
    consumptionSource: answers.consumptionSource,
    emotionalNeed: answers.emotionalNeed,
    emotionalImagery: answers.emotionalImagery,
    userIntent: `用户现在更需要一张围绕“${answers.emotionalNeed}”展开的歌单。`,
    todayStateSummary: `今天更像是被“${answers.consumptionSource}”消耗后，想把自己放进“${answers.emotionalImagery}”的情绪空间里。`,
    moodSignals: [answers.consumptionSource, answers.emotionalNeed],
    sceneSignals: [answers.emotionalImagery],
    objectiveSignals: ["先稳定情绪，再给到一点陪伴感和代入感"],
    constraints: ["优先选择与当前情绪意境贴合的歌", "避免过于跳脱的情绪转换"],
    playlistStrategy: "基于三道题答案直接生成保守版选歌计划，在模型不可用时优先保证可出歌单。",
    queryHints: [answers.consumptionSource, answers.emotionalNeed, answers.emotionalImagery],
    explanationStyle: "结论先行，语气自然，给出简洁但有导购感的推荐理由。",
    uncertainty: [reason],
  };
}

export class AotdPlanner {
  private readonly runtime: ClaudeStyleAgentRuntime;

  constructor(client: LLMClient) {
    this.runtime = new ClaudeStyleAgentRuntime({
      client,
      systemPrompt: buildAotdSystemPrompt(),
      seedMessages: buildFewShotMessages(aotdFewShotExamples),
    });
  }

  async plan(request: AotdRequest): Promise<AotdPlan> {
    const questionnaireInput = renderQuestionnaireAnswers(request.answers);
    const raw = await this.runtime.run(
      [
        "以下是用户完成 AOTD 三道题后的答案：",
        questionnaireInput,
        "请基于 few-shot 样例输出 AOTD 选歌计划 JSON。",
        "字段必须包括：consumptionSource, emotionalNeed, emotionalImagery, userIntent, todayStateSummary, moodSignals, sceneSignals, objectiveSignals, constraints, playlistStrategy, queryHints, explanationStyle, uncertainty。",
      ].join("\n"),
    );

    try {
      const parsed = JSON.parse(raw);
      const result = AotdPlanSchema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }

      return buildFallbackPlan(request, `模型返回的计划字段不完整，已切换到兜底选歌逻辑。`);
    } catch {
      return buildFallbackPlan(request, "模型返回结果无法解析为 JSON，已切换到兜底选歌逻辑。");
    }
  }
}
