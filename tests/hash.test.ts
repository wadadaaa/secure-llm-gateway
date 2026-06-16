import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  hashApiKey,
  hashJson,
  sha256,
} from "../src/security/hash";

describe("hash", () => {
  it("sha256 is deterministic and 64 hex chars", () => {
    const a = sha256("hello");
    expect(a).toBe(sha256("hello"));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256("hello")).not.toBe(sha256("world"));
  });

  it("hashApiKey never returns the raw key", () => {
    const raw = "sllm_client_secret";
    expect(hashApiKey(raw)).not.toContain(raw);
    expect(hashApiKey(raw)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashJson is stable for equal objects", () => {
    expect(hashJson({ a: 1, b: 2 })).toBe(hashJson({ a: 1, b: 2 }));
    expect(hashJson({ a: 1 })).not.toBe(hashJson({ a: 2 }));
  });

  describe("constantTimeEqual", () => {
    it("returns true for equal strings", () => {
      expect(constantTimeEqual("abc123", "abc123")).toBe(true);
    });

    it("returns false for different strings of equal length", () => {
      expect(constantTimeEqual("abc123", "abc124")).toBe(false);
    });

    it("returns false for different lengths without throwing", () => {
      expect(constantTimeEqual("abc", "abcdef")).toBe(false);
    });
  });
});
