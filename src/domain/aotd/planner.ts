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

    return AotdPlanSchema.parse(JSON.parse(raw));
  }
}
