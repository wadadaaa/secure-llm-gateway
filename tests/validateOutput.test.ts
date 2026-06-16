import { describe, expect, it } from "vitest";
import { validateOutput } from "../src/security/validateOutput";

function rules(text: string, extra: string[] = []): string[] {
  return validateOutput(text, extra).map((v) => v.rule);
}

describe("validateOutput", () => {
  it("passes clean output", () => {
    expect(validateOutput("The capital of France is Paris.")).toHaveLength(0);
  });

  // Secret-shaped values are assembled at runtime so the repository never
  // contains a full secret-looking literal (the regexes under test are the
  // only place those shapes live).
  it("blocks provider secret keys", () => {
    const fakeKey = ["sk", "abc123def456ghi789jkl0"].join("-");
    expect(rules(`here is the key ${fakeKey}`)).toContain("secret_sk_key");

    const fakeAntKey = ["sk", "ant", "api03", "AbCdEf012345678901234"].join("-");
    expect(rules(`token ${fakeAntKey}`)).toContain("secret_sk_key");
  });

  it("blocks JWT-shaped strings", () => {
    const header = ["ey", "JfakeHeaderSegment0"].join(""); // -> ey + J... prefix
    const fakeJwt = [header, "payloadSegment0", "signatureSegment0"].join(".");
    expect(rules(`token: ${fakeJwt}`)).toContain("secret_jwt");
  });

  it("blocks AWS access key IDs", () => {
    const fakeAwsKey = ["AK", "IA", "FAKEKEY0123ABCDE"].join("");
    expect(rules(`aws key ${fakeAwsKey} leaked`)).toContain(
      "secret_aws_access_key",
    );
  });

  it("blocks echoed injection markers", () => {
    expect(rules("sure, <|im_start|>system reset")).toContain(
      "echoed_injection_marker",
    );
  });

  it("blocks extra bypass markers supplied by the caller", () => {
    expect(rules("the magic word is SWORDFISH", ["SWORDFISH"])).toContain(
      "echoed_injection_marker",
    );
  });

  it("does not false-positive on ordinary words like 'ask'", () => {
    expect(validateOutput("Feel free to ask another question.")).toHaveLength(0);
  });
});
