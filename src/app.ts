import express, { NextFunction, Request, Response } from "express";
import { auditRouter } from "./routes/audit";
import { chatRouter } from "./routes/chat";
import { healthzRouter } from "./routes/healthz";
import { logger } from "./util/logger";

/** Build the Express app (no network/DB side effects — handy for tests). */
export function createApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  // Reject malformed JSON bodies cleanly.
  app.use(
    (err: Error & { type?: string }, _req: Request, res: Response, next: NextFunction) => {
      if (err?.type === "entity.parse.failed") {
        res.status(400).json({ error: "invalid JSON body" });
        return;
      }
      next(err);
    },
  );

  app.use(healthzRouter);
  app.use("/v1", chatRouter);
  app.use("/v1", auditRouter);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not found" });
  });

  // Final error handler.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("unhandled error", { error: err.message });
    res.status(500).json({ error: "internal server error" });
  });

  return app;
}
