import type { ChatMessage, LLMClient } from "./types.js";

interface RuntimeOptions {
  client: LLMClient;
  systemPrompt: string;
  seedMessages?: ChatMessage[];
}

export class ClaudeStyleAgentRuntime {
  private readonly client: LLMClient;
  private readonly systemPrompt: string;
  private readonly seedMessages: ChatMessage[];

  constructor(options: RuntimeOptions) {
    this.client = options.client;
    this.systemPrompt = options.systemPrompt;
    this.seedMessages = options.seedMessages ?? [];
  }

  async run(userMessage: string): Promise<string> {
    const messages: ChatMessage[] = [
      ...this.seedMessages,
      { role: "user", content: userMessage },
    ];

    return this.client.generate({
      systemPrompt: this.systemPrompt,
      messages,
      temperature: 0.2,
      maxTokens: 1200,
    });
  }
}
