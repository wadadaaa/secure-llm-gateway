import { describe, expect, it } from "vitest";
import { inspectInjection } from "../src/security/detectInjection";
import { redactPii } from "../src/security/redactPii";
import { validateOutput } from "../src/security/validateOutput";
import {
  echoedMarkers,
  injectionCases,
  piiCases,
  REQUIRED_APPENDIX_A_IDS,
} from "./fixtures/adversarialCorpus";

describe("Appendix A adversarial corpus", () => {
  describe("injection cases (INJ-*) are blocked", () => {
    for (const c of injectionCases) {
      it(`${c.id}: base input is detected with the expected rule(s)`, () => {
        const result = inspectInjection(c.input);
        expect(result.isDetected).toBe(true);
        expect(result.rules.length).toBeGreaterThanOrEqual(1);
        for (const rule of c.expectedRules) {
          expect(result.rules).toContain(rule);
        }
        expect(c.outcome).toBe("block");
      });

      it(`${c.id}: has at least one variation`, () => {
        expect(c.variations.length).toBeGreaterThanOrEqual(1);
      });

      for (const [i, variation] of c.variations.entries()) {
        it(`${c.id}: variation #${i + 1} is still detected`, () => {
          const result = inspectInjection(variation);
          expect(result.isDetected).toBe(true);
          expect(result.rules.length).toBeGreaterThanOrEqual(1);
        });
      }
    }
  });

  describe("PII cases (PII-*) are redacted", () => {
    for (const c of piiCases) {
      it(`${c.id}: redacts expected PII categories with reversible tokens`, () => {
        const { redacted, mapping, counts } = redactPii(c.input);
        expect(c.outcome).toBe("redact");
        for (const cat of c.expectedPii) {
          expect(counts[cat]).toBeGreaterThanOrEqual(1);
          expect(redacted).toContain(`[REDACTED_${cat}_1]`);
        }
        // Original PII values must not survive in the redacted text.
        for (const original of Object.values(mapping)) {
          expect(redacted).not.toContain(original);
        }
      });
    }
  });

  describe("output validation blocks echoed injection markers", () => {
    for (const marker of echoedMarkers) {
      it(`rejects output echoing "${marker}"`, () => {
        const violations = validateOutput(`assistant reply: ${marker} done`);
        expect(violations.map((v) => v.rule)).toContain(
          "echoed_injection_marker",
        );
      });
    }
  });

  describe("coverage guard", () => {
    it("fixture contains every required Appendix A id", () => {
      const present = new Set([
        ...injectionCases.map((c) => c.id),
        ...piiCases.map((c) => c.id),
      ]);
      for (const id of REQUIRED_APPENDIX_A_IDS) {
        expect(present.has(id)).toBe(true);
      }
    });

    it("fixture has no duplicate ids", () => {
      const ids = [
        ...injectionCases.map((c) => c.id),
        ...piiCases.map((c) => c.id),
      ];
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
