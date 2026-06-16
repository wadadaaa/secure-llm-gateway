import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env";
import {
  CompletionRequest,
  CompletionResult,
  Provider,
  ProviderError,
} from "./provider";

/**
 * Real Anthropic integration (the primary provider).
 *
 * The public alias "claude-3-5-sonnet" is retired upstream, so we resolve it to
 * a currently-valid model id from config (ANTHROPIC_MODEL).
 */
export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  private client: Anthropic | null = null;

  isReady(): boolean {
    return env.anthropicApiKey.length > 0;
  }

  private getClient(): Anthropic {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: env.anthropicApiKey });
    }
    return this.client;
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    if (!this.isReady()) {
      throw new ProviderError("Anthropic provider not configured", 503);
    }

    // Anthropic takes the system prompt as a separate parameter.
    const system = req.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    const messages = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content,
      }));

    try {
      const resp = await this.getClient().messages.create({
        model: env.anthropicModel,
        max_tokens: req.maxTokens,
        ...(system ? { system } : {}),
        messages,
      });

      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      return { text };
    } catch (err) {
      const status =
        err instanceof Anthropic.APIError && typeof err.status === "number"
          ? err.status
          : 502;
      throw new ProviderError(
        `Anthropic request failed: ${(err as Error).message}`,
        status >= 500 ? 502 : status,
      );
    }
  }
}
