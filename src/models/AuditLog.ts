import { Collection } from "mongodb";
import { getDb } from "../db/mongo";

export type AuditStatus = "allowed" | "blocked" | "error";

export interface AuditLog {
  timestamp: Date;
  /** Public key id (never the raw key). */
  apiKeyId: string;
  model: string;
  requestHash: string;
  responseHash: string;
  /** Names of detection rules / violations that fired. */
  detectedThreats: string[];
  latencyMs: number;
  status: AuditStatus;
  /**
   * Sensitive detail kept out of stdout logs but retained for audit:
   * the PII token mapping and any error message. Stored in Mongo only.
   */
  auditData?: {
    redactions?: Record<string, string>;
    detail?: string;
  };
}

function collection(): Collection<AuditLog> {
  return getDb().collection<AuditLog>("auditLogs");
}

/** Write one audit record. */
export async function writeAuditLog(entry: AuditLog): Promise<void> {
  await collection().insertOne(entry);
}

/**
 * Query audit entries created on or after `since`, newest first.
 * `limit` is clamped to [1, 500] by the caller (the route enforces <= 500).
 */
export async function queryAuditLogs(
  since: Date,
  limit: number,
): Promise<AuditLog[]> {
  return collection()
    .find({ timestamp: { $gte: since } })
    .sort({ timestamp: -1 })
    .limit(limit)
    .project<AuditLog>({ "auditData.redactions": 0 }) // never expose token map
    .toArray();
}
