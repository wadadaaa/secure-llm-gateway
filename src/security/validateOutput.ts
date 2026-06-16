/**
 * Output validation: treat the LLM response as untrusted and block responses
 * that leak secret-shaped strings or echo known injection markers.
 *
 * Pure functions only.
 */

import { BYPASS_INDICATORS, INJECTION_MARKERS } from "./detectInjection";

export interface OutputViolation {
  rule: string;
  description: string;
  match: string;
}

interface OutputRule {
  name: string;
  description: string;
  pattern: RegExp;
}

const SECRET_RULES: OutputRule[] = [
  {
    name: "secret_sk_key",
    description: "Provider secret key (sk-...)",
    // OpenAI/Anthropic-style secret keys, incl. sk-proj-/sk-ant- variants.
    pattern: /\bsk-(?:proj-|ant-|live-)?[A-Za-z0-9_-]{16,}\b/,
  },
  {
    name: "secret_jwt",
    description: "JWT-shaped token",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  },
  {
    name: "secret_aws_access_key",
    description: "AWS access key ID",
    pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}\b/,
  },
];

const MATCH_PREVIEW_LIMIT = 120;

function preview(value: string): string {
  return value.length > MATCH_PREVIEW_LIMIT
    ? `${value.slice(0, MATCH_PREVIEW_LIMIT)}…`
    : value;
}

/**
 * Validate an LLM output string.
 *
 * @param text         Raw model output (validate BEFORE un-redacting PII).
 * @param extraMarkers Additional bypass-indicator strings to block if echoed
 *                     (e.g. markers that fired on the way in).
 * @returns list of violations; empty means the output is safe to return.
 */
export function validateOutput(
  text: string,
  extraMarkers: string[] = [],
): OutputViolation[] {
  if (!text) return [];
  const violations: OutputViolation[] = [];

  for (const rule of SECRET_RULES) {
    const m = rule.pattern.exec(text);
    if (m) {
      violations.push({
        rule: rule.name,
        description: rule.description,
        match: preview(m[0]),
      });
    }
  }

  const haystack = text.toLowerCase();
  const markers = [...INJECTION_MARKERS, ...BYPASS_INDICATORS, ...extraMarkers];
  for (const marker of markers) {
    const needle = marker.toLowerCase();
    if (needle && haystack.includes(needle)) {
      violations.push({
        rule: "echoed_injection_marker",
        description: "Response echoes a known injection / bypass marker",
        match: preview(marker),
      });
    }
  }

  return violations;
}
