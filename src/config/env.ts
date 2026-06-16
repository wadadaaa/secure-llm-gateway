import "dotenv/config";

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Central, validated view of configuration. Provider keys come from env vars
 * only — they are never hardcoded and never logged.
 */
export const env = {
  port: num(process.env.PORT, 8080),

  mongoUri: process.env.MONGO_URI ?? "mongodb://localhost:27017",
  mongoDb: process.env.MONGO_DB ?? "securellm",

  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",

  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",

  // Real provider model IDs the public aliases resolve to.
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o",

  rateLimitDefault: num(process.env.RATE_LIMIT_DEFAULT, 30),
  rateLimitWindowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 60_000),

  adminBootstrapKey: process.env.ADMIN_BOOTSTRAP_KEY ?? "",
} as const;

/** Public model aliases accepted by /v1/chat. */
export const SUPPORTED_MODELS = ["claude-3-5-sonnet", "gpt-4o"] as const;
export type SupportedModel = (typeof SUPPORTED_MODELS)[number];
