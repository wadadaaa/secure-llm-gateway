import { createApp } from "./app";
import { env } from "./config/env";
import { closeMongo, connectMongo } from "./db/mongo";
import { closeRedis, getRedis } from "./db/redis";
import { anyProviderReady } from "./providers";
import { logger } from "./util/logger";

async function main(): Promise<void> {
  // Connect dependencies. Mongo is required to start; the service still boots
  // without a provider key (per spec — /v1/chat will 503 in that case).
  await connectMongo();
  getRedis(); // eager-create the client

  if (!anyProviderReady()) {
    logger.warn(
      "no LLM provider key configured — service will start but /v1/chat will return 503",
    );
  }

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info("securellm-gateway listening", { port: env.port });
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("shutting down", { signal });
    server.close();
    await Promise.allSettled([closeMongo(), closeRedis()]);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error("failed to start", { error: (err as Error).message });
  process.exit(1);
});
