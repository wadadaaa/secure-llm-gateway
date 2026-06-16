import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Pure cryptographic helpers used across the security pipeline.
 * No I/O, no env access — trivially unit-testable.
 */

/** SHA-256 hex digest of a UTF-8 string. */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Stable hash of an arbitrary JSON-serialisable value (for request/response hashes). */
export function hashJson(value: unknown): string {
  return sha256(JSON.stringify(value));
}

/** Hash an API key for storage / comparison. We never store the raw key. */
export function hashApiKey(rawKey: string): string {
  return sha256(rawKey);
}

/**
 * Constant-time string comparison. Returns false for length mismatch without
 * leaking timing information about matching prefixes. Used to compare API key
 * hashes so a presented key cannot be discovered byte-by-byte via timing.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Still do a comparison against a same-length buffer to keep timing flat.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
