import { Response, Router } from "express";
import { authenticate, AuthedRequest, requireAdmin } from "../middleware/auth";
import { queryAuditLogs } from "../models/AuditLog";

const MAX_LIMIT = 500;

export const auditRouter = Router();

/**
 * GET /v1/audit?since=<ISO|epoch-ms>&limit=<n>
 * Admin only. Returns audit entries since `since`, newest first. `limit` is
 * clamped to <= 500. The PII token mapping is never returned.
 */
auditRouter.get(
  "/audit",
  authenticate,
  requireAdmin,
  async (req: AuthedRequest, res: Response) => {
    const sinceRaw = req.query.since;
    let since = new Date(0);
    if (typeof sinceRaw === "string" && sinceRaw.length > 0) {
      const asNumber = Number(sinceRaw);
      const parsed = Number.isFinite(asNumber)
        ? new Date(asNumber)
        : new Date(sinceRaw);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: "invalid 'since' timestamp" });
        return;
      }
      since = parsed;
    }

    let limit = 100;
    const limitRaw = req.query.limit;
    if (typeof limitRaw === "string" && limitRaw.length > 0) {
      const n = Number(limitRaw);
      if (!Number.isInteger(n) || n < 1) {
        res.status(400).json({ error: "limit must be a positive integer" });
        return;
      }
      limit = n;
    }
    limit = Math.min(limit, MAX_LIMIT);

    const entries = await queryAuditLogs(since, limit);
    res.status(200).json({ since: since.toISOString(), limit, entries });
  },
);
