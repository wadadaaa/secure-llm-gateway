/**
 * Provider abstraction. The gateway routes a public model alias to a concrete
 * provider implementation. Readiness depends on whether the relevant API key
 * is configured (keys come from env vars only).
 */

export interface ChatMessage {
  role: string; // user | assistant | system
  content: string;
}

export interface CompletionRequest {
  /** Public model alias requested by the client (e.g. "claude-3-5-sonnet"). */
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
}

export interface CompletionResult {
  /** Concatenated assistant text. */
  text: string;
}

export interface Provider {
  readonly name: string;
  /** True if this provider is configured and usable. */
  isReady(): boolean;
  complete(req: CompletionRequest): Promise<CompletionResult>;
}

/** Error type thrown when a provider call fails. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number = 502,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
