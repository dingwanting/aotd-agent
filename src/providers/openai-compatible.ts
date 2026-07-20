import type { GenerateParams, LLMClient } from "../core/types.js";

interface OpenAICompatibleClientOptions {
  apiKey?: string;
  model: string;
  baseUrl: string;
}

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function extractTextContent(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => item.text || "")
      .filter(Boolean)
      .join("\n");
  }

  return "";
}

export class OpenAICompatibleClient implements LLMClient {
  constructor(private readonly options: OpenAICompatibleClientOptions) {}

  async generate(params: GenerateParams): Promise<string> {
    if (!this.options.apiKey) {
      return JSON.stringify(
        {
          userIntent: "AOTD mock plan",
          moodSignals: ["待识别"],
          sceneSignals: ["待识别"],
          objectiveSignals: ["待识别"],
          constraints: [],
          playlistStrategy: "当前未配置 OPENAI_API_KEY，返回 mock 计划以便先开发流程。",
          queryHints: ["aotd", "mock"],
          explanationStyle: "简洁说明",
          uncertainty: ["未连接真实 OpenAI 兼容模型"],
        },
        null,
        2,
      );
    }

    const response = await fetch(`${normalizeBaseUrl(this.options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: params.temperature ?? 0.3,
        max_tokens: params.maxTokens ?? 1200,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: params.systemPrompt },
          ...params.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        ],
      }),
    });

    const data = (await response.json()) as OpenAICompatibleResponse;

    if (!response.ok) {
      const detail = data.error?.message ? `: ${data.error.message}` : "";
      throw new Error(`OpenAI-compatible API error: ${response.status} ${response.statusText}${detail}`);
    }

    const text = extractTextContent(data.choices?.[0]?.message?.content);
    if (!text) {
      throw new Error("OpenAI-compatible API returned empty text content.");
    }

    return text;
  }
}
