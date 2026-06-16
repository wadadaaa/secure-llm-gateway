import { describe, expect, it } from "vitest";
import {
  isValidIsraeliId,
  redactMessages,
  redactPii,
  restorePii,
} from "../src/security/redactPii";

describe("redactPii", () => {
  it("redacts email addresses with reversible tokens", () => {
    const { redacted, mapping } = redactPii("contact me at jane.doe@example.com");
    expect(redacted).toContain("[REDACTED_EMAIL_1]");
    expect(redacted).not.toContain("jane.doe@example.com");
    expect(mapping["[REDACTED_EMAIL_1]"]).toBe("jane.doe@example.com");
  });

  it("redacts Israeli mobile numbers (grouped and ungrouped)", () => {
    const a = redactPii("call 050-123-4567 today");
    expect(a.redacted).toContain("[REDACTED_PHONE_1]");
    expect(a.redacted).not.toContain("050-123-4567");

    const b = redactPii("call 0501234567 today");
    expect(b.redacted).toContain("[REDACTED_PHONE_1]");
  });

  it("redacts international phone numbers", () => {
    const { redacted } = redactPii("my number is +972-50-123-4567 ok");
    expect(redacted).toContain("[REDACTED_PHONE_1]");
    expect(redacted).not.toContain("+972-50-123-4567");
  });

  it("validates Israeli national IDs by check digit", () => {
    expect(isValidIsraeliId("123456782")).toBe(true);
    expect(isValidIsraeliId("000000018")).toBe(true);
    expect(isValidIsraeliId("123456789")).toBe(false);
    expect(isValidIsraeliId("12345")).toBe(false);
  });

  it("redacts only checksum-valid Israeli IDs", () => {
    const valid = redactPii("id 123456782 here");
    expect(valid.redacted).toContain("[REDACTED_ID_1]");

    const invalid = redactPii("id 123456789 here");
    expect(invalid.redacted).toContain("123456789");
    expect(invalid.counts.ID).toBe(0);
  });

  it("reuses one token for repeated values", () => {
    const { redacted, mapping } = redactPii(
      "a@b.com and again a@b.com",
    );
    expect(mapping["[REDACTED_EMAIL_1]"]).toBe("a@b.com");
    expect(mapping["[REDACTED_EMAIL_2]"]).toBeUndefined();
    expect(redacted.match(/REDACTED_EMAIL_1/g)).toHaveLength(2);
  });

  it("restorePii reverses redaction exactly", () => {
    const original = "mail a@b.com phone 050-123-4567 id 123456782";
    const { redacted, mapping } = redactPii(original);
    expect(restorePii(redacted, mapping)).toBe(original);
  });

  it("shares one token namespace across messages", () => {
    const { messages, mapping } = redactMessages([
      { role: "user", content: "email a@b.com" },
      { role: "user", content: "same email a@b.com" },
    ]);
    expect(messages[0]?.content).toContain("[REDACTED_EMAIL_1]");
    expect(messages[1]?.content).toContain("[REDACTED_EMAIL_1]");
    expect(Object.keys(mapping)).toHaveLength(1);
  });

  it("leaves clean text untouched", () => {
    const { redacted, counts } = redactPii("no pii here at all");
    expect(redacted).toBe("no pii here at all");
    expect(counts).toEqual({ EMAIL: 0, PHONE: 0, ID: 0 });
  });
});
