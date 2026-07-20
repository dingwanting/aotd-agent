import type { ChatMessage } from "../core/types.js";
import type { FewShotExample } from "../domain/aotd/few-shot-examples.js";

export function buildFewShotMessages(examples: FewShotExample[]): ChatMessage[] {
  return examples.flatMap((example) => [
    {
      role: "user",
      content: `用户输入：${example.input}\n请输出 AOTD 选歌计划 JSON。`,
    },
    {
      role: "assistant",
      content: JSON.stringify(example.output, null, 2),
    },
  ]);
}
