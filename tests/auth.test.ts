import { describe, expect, it } from "vitest";
import { ApiKey, verifyApiKey } from "../src/models/ApiKey";
import { hashApiKey } from "../src/security/hash";

function record(rawKey: string, overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    keyId: "client-1",
    keyHash: hashApiKey(rawKey),
    role: "client",
    name: "test",
    rateLimitPerMin: null,
    disabled: false,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("verifyApiKey", () => {
  const raw = "sllm_client_0123456789abcdef";

  it("accepts the correct key via constant-time hash comparison", () => {
    expect(verifyApiKey(record(raw), raw)).toBe(true);
  });

  it("rejects an incorrect key", () => {
    expect(verifyApiKey(record(raw), "sllm_client_wrong")).toBe(false);
  });

  it("rejects a disabled key even when correct", () => {
    expect(verifyApiKey(record(raw, { disabled: true }), raw)).toBe(false);
  });

  it("stores only the hash, never the raw key", () => {
    const rec = record(raw);
    expect(rec.keyHash).not.toContain(raw);
    expect(rec.keyHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
