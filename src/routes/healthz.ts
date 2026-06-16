import { Request, Response, Router } from "express";
import { pingMongo } from "../db/mongo";
import { pingRedis } from "../db/redis";
import { anthropic, openai } from "../providers";

export const healthzRouter = Router();

/**
 * GET /healthz — no auth. Reports Mongo + Redis reachability and provider
 * readiness. Returns 503 if a hard dependency (Mongo/Redis) is down. A missing
 * provider key does NOT make the service unhealthy (the service still starts);
 * it is reported informationally and causes /v1/chat to 503 instead.
 */
healthzRouter.get("/healthz", async (_req: Request, res: Response) => {
  const [mongo, redis] = await Promise.all([pingMongo(), pingRedis()]);
  const providers = {
    anthropic: anthropic.isReady(),
    openai: openai.isReady(),
  };
  const providerReady = providers.anthropic || providers.openai;

  const healthy = mongo && redis;
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    mongo,
    redis,
    providers,
    providerReady,
  });
});
