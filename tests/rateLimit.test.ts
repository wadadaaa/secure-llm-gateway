import { describe, expect, it } from "vitest";
import { checkRateLimit, RateLimitStore } from "../src/middleware/rateLimit";

/** In-memory fake of the small Redis sorted-set surface used by checkRateLimit. */
class FakeStore implements RateLimitStore {
  private sets = new Map<string, { score: number; member: string }[]>();

  private get(key: string): { score: number; member: string }[] {
    let s = this.sets.get(key);
    if (!s) {
      s = [];
      this.sets.set(key, s);
    }
    return s;
  }

  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    const s = this.get(key);
    const before = s.length;
    const kept = s.filter((e) => e.score < min || e.score > max);
    this.sets.set(key, kept);
    return before - kept.length;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    this.get(key).push({ score, member });
    return 1;
  }

  async zcard(key: string): Promise<number> {
    return this.get(key).length;
  }

  async pexpire(): Promise<number> {
    return 1;
  }
}

describe("checkRateLimit (sliding window)", () => {
  it("allows up to the limit then blocks", async () => {
    const store = new FakeStore();
    const now = 1_000_000;
    const limit = 3;
    const windowMs = 60_000;

    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await checkRateLimit(store, "k1", limit, windowMs, now + i));
    }

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]?.count).toBe(4);
    expect(results[2]?.remaining).toBe(0);
  });

  it("ages out old entries so requests are allowed again", async () => {
    const store = new FakeStore();
    const limit = 2;
    const windowMs = 60_000;
    const t0 = 1_000_000;

    await checkRateLimit(store, "k2", limit, windowMs, t0);
    await checkRateLimit(store, "k2", limit, windowMs, t0 + 1);
    const blocked = await checkRateLimit(store, "k2", limit, windowMs, t0 + 2);
    expect(blocked.allowed).toBe(false);

    // Far in the future — earlier entries fall outside the window.
    const later = await checkRateLimit(store, "k2", limit, windowMs, t0 + windowMs + 10);
    expect(later.allowed).toBe(true);
    expect(later.count).toBe(1);
  });

  it("tracks limits independently per key", async () => {
    const store = new FakeStore();
    const now = 2_000_000;
    const a = await checkRateLimit(store, "a", 1, 60_000, now);
    const b = await checkRateLimit(store, "b", 1, 60_000, now);
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });
});
