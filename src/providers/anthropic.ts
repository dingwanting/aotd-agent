import type { ChatMessage, GenerateParams, LLMClient } from "../core/types.js";

interface AnthropicClientOptions {
  apiKey?: string;
  model: string;
}

function normalizeMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content: [{ type: "text", text: message.content }],
  }));
}

export class AnthropicMessagesClient implements LLMClient {
  constructor(private readonly options: AnthropicClientOptions) {}

  async generate(params: GenerateParams): Promise<string> {
    if (!this.options.apiKey) {
      return JSON.stringify(
        {
          userIntent: "AOTD mock plan",
          moodSignals: ["待识别"],
          sceneSignals: ["待识别"],
          objectiveSignals: ["待识别"],
          constraints: [],
          playlistStrategy: "当前未配置 ANTHROPIC_API_KEY，返回 mock 计划以便先开发流程。",
          queryHints: ["aotd", "mock"],
          explanationStyle: "简洁说明",
          uncertainty: ["未连接真实 Claude 模型"],
        },
        null,
        2,
      );
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.options.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.options.model,
        system: params.systemPrompt,
        max_tokens: params.maxTokens ?? 1200,
        temperature: params.temperature ?? 0.3,
        messages: normalizeMessages(params.messages),
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    const text = data.content?.find((item) => item.type === "text")?.text;
    if (!text) {
      throw new Error("Anthropic API returned empty text content.");
    }

    return text;
  }
}
