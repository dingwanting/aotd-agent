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

const REQUEST_TIMEOUT_MS = 12000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? String(error.name || "") : "";
  const message = "message" in error ? String(error.message || "") : "";
  return name === "AbortError" || /timeout|timed out|fetch failed|network/i.test(message);
}

function parseJsonSafely(raw: string): OpenAICompatibleResponse {
  try {
    return JSON.parse(raw) as OpenAICompatibleResponse;
  } catch {
    return {};
  }
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

    const requestBody = JSON.stringify({
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
    });

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(`${normalizeBaseUrl(this.options.baseUrl)}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.options.apiKey}`,
          },
          body: requestBody,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        const rawBody = await response.text();
        const data = parseJsonSafely(rawBody);

        if (!response.ok) {
          const detail = data.error?.message ? `: ${data.error.message}` : rawBody ? `: ${rawBody.slice(0, 240)}` : "";
          const error = new Error(`OpenAI-compatible API error: ${response.status} ${response.statusText}${detail}`);
          if (attempt < MAX_RETRY_ATTEMPTS && isRetryableStatus(response.status)) {
            await sleep(300 * attempt);
            continue;
          }
          throw error;
        }

        const text = extractTextContent(data.choices?.[0]?.message?.content);
        if (!text) {
          throw new Error("OpenAI-compatible API returned empty text content.");
        }

        return text;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < MAX_RETRY_ATTEMPTS && isRetryableError(error)) {
          await sleep(300 * attempt);
          continue;
        }
        throw lastError;
      }
    }

    throw lastError || new Error("OpenAI-compatible API request failed.");
  }
}
