/**
 * Reversible, token-based PII redaction.
 *
 * Redacts: email addresses, Israeli + international phone numbers, and Israeli
 * national ID numbers. Each distinct value gets a stable token of the form
 * [REDACTED_EMAIL_1]; the token -> original mapping is returned so callers can
 * restore the original text in the outbound response. The mapping is NEVER
 * logged to stdout — it is stored only in the audit record.
 *
 * Pure functions only.
 */

export type PiiKind = "EMAIL" | "PHONE" | "ID";

export interface RedactionResult {
  /** Text with PII replaced by tokens. */
  redacted: string;
  /** token -> original value (the reversal map). */
  mapping: Record<string, string>;
  /** Count of redactions performed, by kind. */
  counts: Record<PiiKind, number>;
}

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Israeli national ID: exactly 9 digits, validated with the official check digit.
const ID_CANDIDATE_RE = /\b\d{9}\b/g;

// Phone patterns, applied in order. International (E.164-ish) first.
const PHONE_RES: RegExp[] = [
  /\+\d{1,3}[-\s]?\(?\d{1,4}\)?(?:[-\s]?\d{2,4}){2,4}/g, // international
  /\b0\d{1,2}[-\s]?\d{3}[-\s]?\d{4}\b/g, // Israeli, grouped (e.g. 050-123-4567)
  /\b0\d{1,2}[-\s]?\d{7}\b/g, // Israeli, ungrouped (e.g. 0501234567 / 02-1234567)
];

/** Validate an Israeli national ID using its Luhn-style check digit. */
export function isValidIsraeliId(id: string): boolean {
  if (!/^\d{9}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let digit = Number(id[i]) * ((i % 2) + 1);
    if (digit > 9) digit -= 9;
    sum += digit;
  }
  return sum % 10 === 0;
}

interface Tokenizer {
  counts: Record<PiiKind, number>;
  mapping: Record<string, string>;
  /** original value -> token, so identical values reuse the same token. */
  reverse: Map<string, string>;
}

function tokenFor(t: Tokenizer, kind: PiiKind, original: string): string {
  const existing = t.reverse.get(`${kind}:${original}`);
  if (existing) return existing;
  t.counts[kind] += 1;
  const token = `[REDACTED_${kind}_${t.counts[kind]}]`;
  t.mapping[token] = original;
  t.reverse.set(`${kind}:${original}`, token);
  return token;
}

/**
 * Redact PII from a single string. Order matters: emails first (they contain
 * `@`), then IDs (checksum-validated 9-digit numbers), then phone numbers —
 * once digits are replaced by a token they can't be re-matched by a later rule.
 */
export function redactPii(text: string): RedactionResult {
  const t: Tokenizer = {
    counts: { EMAIL: 0, PHONE: 0, ID: 0 },
    mapping: {},
    reverse: new Map(),
  };
  if (!text) {
    return { redacted: text ?? "", mapping: {}, counts: t.counts };
  }

  let out = text.replace(EMAIL_RE, (m) => tokenFor(t, "EMAIL", m));

  out = out.replace(ID_CANDIDATE_RE, (m) =>
    isValidIsraeliId(m) ? tokenFor(t, "ID", m) : m,
  );

  for (const re of PHONE_RES) {
    out = out.replace(re, (m) => tokenFor(t, "PHONE", m));
  }

  return { redacted: out, mapping: t.mapping, counts: t.counts };
}

export interface MessageLike {
  role: string;
  content: string;
}

/**
 * Redact PII across a list of messages, sharing one token namespace so the same
 * value gets the same token everywhere. Returns redacted messages + combined map.
 */
export function redactMessages(messages: MessageLike[]): {
  messages: MessageLike[];
  mapping: Record<string, string>;
  counts: Record<PiiKind, number>;
} {
  const t: Tokenizer = {
    counts: { EMAIL: 0, PHONE: 0, ID: 0 },
    mapping: {},
    reverse: new Map(),
  };

  const redacted = messages.map((msg) => {
    let out = (msg.content ?? "").replace(EMAIL_RE, (m) =>
      tokenFor(t, "EMAIL", m),
    );
    out = out.replace(ID_CANDIDATE_RE, (m) =>
      isValidIsraeliId(m) ? tokenFor(t, "ID", m) : m,
    );
    for (const re of PHONE_RES) {
      out = out.replace(re, (m) => tokenFor(t, "PHONE", m));
    }
    return { role: msg.role, content: out };
  });

  return { messages: redacted, mapping: t.mapping, counts: t.counts };
}

/** Reverse a redaction: replace tokens with their original values. */
export function restorePii(text: string, mapping: Record<string, string>): string {
  let out = text;
  for (const [token, original] of Object.entries(mapping)) {
    out = out.split(token).join(original);
  }
  return out;
}
