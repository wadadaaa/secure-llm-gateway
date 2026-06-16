import { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import { constantTimeEqual, hashApiKey } from "../security/hash";

export type Role = "client" | "admin";

export interface ApiKey {
  /** Public, non-secret identifier for this key (safe to log). */
  keyId: string;
  /** SHA-256 of the raw key. The raw key is never stored. */
  keyHash: string;
  role: Role;
  name: string;
  /** Per-key rate limit (requests per window). Null => use the default. */
  rateLimitPerMin: number | null;
  disabled: boolean;
  createdAt: Date;
}

function collection(): Collection<ApiKey> {
  return getDb().collection<ApiKey>("apiKeys");
}

/** Look up an active key record by the raw presented key. */
export async function findByRawKey(rawKey: string): Promise<ApiKey | null> {
  const keyHash = hashApiKey(rawKey);
  const record = await collection().findOne({ keyHash, disabled: false });
  if (!record) return null;
  // Constant-time confirmation of the hash match (defence in depth).
  if (!constantTimeEqual(record.keyHash, keyHash)) return null;
  return record;
}

/**
 * Verify a presented raw key against a stored record using a constant-time
 * comparison of hashes. Pure relative to the record — handy for unit tests.
 */
export function verifyApiKey(record: ApiKey, rawKey: string): boolean {
  if (record.disabled) return false;
  return constantTimeEqual(record.keyHash, hashApiKey(rawKey));
}

/** Insert a new key record. */
export async function createApiKey(input: {
  keyId: string;
  rawKey: string;
  role: Role;
  name: string;
  rateLimitPerMin?: number | null;
}): Promise<ApiKey> {
  const record: ApiKey = {
    keyId: input.keyId,
    keyHash: hashApiKey(input.rawKey),
    role: input.role,
    name: input.name,
    rateLimitPerMin: input.rateLimitPerMin ?? null,
    disabled: false,
    createdAt: new Date(),
  };
  await collection().insertOne(record);
  return record;
}
