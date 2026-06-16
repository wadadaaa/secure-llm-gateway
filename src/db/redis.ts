import Redis from "ioredis";
import { env } from "../config/env";

let client: Redis | null = null;

/** Lazily create the shared Redis client. */
export function getRedis(): Redis {
  if (!client) {
    client = new Redis(env.redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
    client.on("error", () => {
      // Swallow connection errors here; surfaced via pingRedis()/healthz.
    });
  }
  return client;
}

/** Liveness check used by /healthz. */
export async function pingRedis(): Promise<boolean> {
  try {
    const res = await getRedis().ping();
    return res === "PONG";
  } catch {
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  await client?.quit();
  client = null;
}
