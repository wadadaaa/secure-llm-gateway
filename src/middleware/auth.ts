import { NextFunction, Request, Response } from "express";
import { ApiKey, findByRawKey } from "../models/ApiKey";

/** Express request augmented with the authenticated API key record. */
export interface AuthedRequest extends Request {
  apiKey?: ApiKey;
}

/**
 * Require a valid `x-api-key`. On success attaches `req.apiKey`.
 * Returns 401 for a missing or unknown/disabled key.
 */
export async function authenticate(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header("x-api-key");
  if (!header) {
    res.status(401).json({ error: "missing x-api-key header" });
    return;
  }

  try {
    const record = await findByRawKey(header);
    if (!record) {
      res.status(401).json({ error: "invalid api key" });
      return;
    }
    req.apiKey = record;
    next();
  } catch {
    res.status(500).json({ error: "authentication failed" });
  }
}

/** Require the authenticated key to have the admin role. Run after authenticate. */
export function requireAdmin(
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (req.apiKey?.role !== "admin") {
    res.status(403).json({ error: "admin role required" });
    return;
  }
  next();
}
