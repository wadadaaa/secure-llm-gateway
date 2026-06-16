import { env } from "../config/env";
import {
  CompletionRequest,
  CompletionResult,
  Provider,
  ProviderError,
} from "./provider";

/**
 * OpenAI integration via the Chat Completions REST API (uses the global fetch
 * available in Node 20+, so no extra dependency).
 */
export class OpenAIProvider implements Provider {
  readonly name = "openai";

  isReady(): boolean {
    return env.openaiApiKey.length > 0;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (!this.isReady()) {
      throw new ProviderError("OpenAI provider not configured", 503);
    }

    let resp: Response;
    try {
      resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: env.openaiModel,
          max_tokens: req.maxTokens,
          messages: req.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });
    } catch (err) {
      throw new ProviderError(
        `OpenAI request failed: ${(err as Error).message}`,
        502,
      );
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new ProviderError(
        `OpenAI returned ${resp.status}: ${body.slice(0, 200)}`,
        resp.status >= 500 ? 502 : resp.status,
      );
    }

    const data = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content ?? "";
    return { text };
  }
}
