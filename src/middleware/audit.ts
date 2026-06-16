import { AuditLog, AuditStatus, writeAuditLog } from "../models/AuditLog";
import { logger } from "../util/logger";

export interface AuditInput {
  apiKeyId: string;
  model: string;
  requestHash: string;
  responseHash?: string;
  detectedThreats?: string[];
  latencyMs: number;
  status: AuditStatus;
  /** Sensitive detail — stored in Mongo only, never logged to stdout. */
  redactions?: Record<string, string>;
  detail?: string;
}

/**
 * Persist one audit record. Resilient: failures are logged but never propagate
 * (auditing must not break the request path). The PII token mapping is written
 * to Mongo but deliberately excluded from the stdout log line.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  const entry: AuditLog = {
    timestamp: new Date(),
    apiKeyId: input.apiKeyId,
    model: input.model,
    requestHash: input.requestHash,
    responseHash: input.responseHash ?? "",
    detectedThreats: input.detectedThreats ?? [],
    latencyMs: input.latencyMs,
    status: input.status,
    auditData: {
      ...(input.redactions ? { redactions: input.redactions } : {}),
      ...(input.detail ? { detail: input.detail } : {}),
    },
  };

  try {
    await writeAuditLog(entry);
  } catch (err) {
    logger.error("failed to write audit log", {
      apiKeyId: input.apiKeyId,
      status: input.status,
      error: (err as Error).message,
    });
  }

  // stdout audit line — note: NO redaction map, NO secrets.
  logger.info("audit", {
    apiKeyId: input.apiKeyId,
    model: input.model,
    status: input.status,
    detectedThreats: entry.detectedThreats,
    latencyMs: input.latencyMs,
  });
}
