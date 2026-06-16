import { Response, Router } from "express";
import { SUPPORTED_MODELS } from "../config/env";
import { authenticate, AuthedRequest } from "../middleware/auth";
import { recordAudit } from "../middleware/audit";
import { rateLimit } from "../middleware/rateLimit";
import { getProviderForModel } from "../providers";
import { ProviderError } from "../providers/provider";
import { detectInjectionInMessages } from "../security/detectInjection";
import { hashJson } from "../security/hash";
import { redactMessages, restorePii } from "../security/redactPii";
import { validateOutput } from "../security/validateOutput";

interface ChatBody {
  model?: unknown;
  messages?: unknown;
  max_tokens?: unknown;
}

interface ValidMessage {
  role: string;
  content: string;
}

const MAX_TOKENS_CAP = 4096;

/** Validate and normalise the request body. Returns an error string or the parsed value. */
function parseBody(
  body: ChatBody,
):
  | { ok: true; model: string; messages: ValidMessage[]; maxTokens: number }
  | { ok: false; error: string } {
  const { model, messages, max_tokens } = body;

  if (typeof model !== "string" || !SUPPORTED_MODELS.includes(model as never)) {
    return {
      ok: false,
      error: `model must be one of: ${SUPPORTED_MODELS.join(", ")}`,
    };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: "messages must be a non-empty array" };
  }

  const parsed: ValidMessage[] = [];
  for (const m of messages) {
    if (
      typeof m !== "object" ||
      m === null ||
      typeof (m as ValidMessage).role !== "string" ||
      typeof (m as ValidMessage).content !== "string"
    ) {
      return {
        ok: false,
        error: "each message must have string 'role' and 'content'",
      };
    }
    const role = (m as ValidMessage).role;
    if (!["user", "assistant", "system"].includes(role)) {
      return { ok: false, error: `unsupported message role: ${role}` };
    }
    parsed.push({ role, content: (m as ValidMessage).content });
  }

  let maxTokens = 1024;
  if (max_tokens !== undefined) {
    if (
      typeof max_tokens !== "number" ||
      !Number.isInteger(max_tokens) ||
      max_tokens < 1
    ) {
      return { ok: false, error: "max_tokens must be a positive integer" };
    }
    maxTokens = Math.min(max_tokens, MAX_TOKENS_CAP);
  }

  return { ok: true, model, messages: parsed, maxTokens };
}

export const chatRouter = Router();

chatRouter.post(
  "/chat",
  authenticate,
  rateLimit,
  async (req: AuthedRequest, res: Response) => {
    const apiKeyId = req.apiKey!.keyId;
    const started = Date.now();

    const parsed = parseBody(req.body as ChatBody);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { model, messages, maxTokens } = parsed;
    const requestHash = hashJson({ model, messages, maxTokens });

    // 1. Prompt-injection detection on every incoming message. This must run
    //    BEFORE the provider readiness check so malicious input is rejected and
    //    audited even when no provider key is configured.
    const findings = detectInjectionInMessages(messages);
    if (findings.length > 0) {
      const threats = [...new Set(findings.map((f) => f.rule))];
      await recordAudit({
        apiKeyId,
        model,
        requestHash,
        detectedThreats: threats,
        latencyMs: Date.now() - started,
        status: "blocked",
        detail: `injection detected: ${threats.join(", ")}`,
      });
      res.status(400).json({
        error: "request blocked by prompt-injection filter",
        rules: threats,
      });
      return;
    }

    // 2. Reversible PII redaction before anything leaves for the provider.
    const { messages: redacted, mapping } = redactMessages(messages);

    // 3. Provider readiness — service starts without a key, but /v1/chat 503s.
    const provider = getProviderForModel(model);
    if (!provider.isReady()) {
      await recordAudit({
        apiKeyId,
        model,
        requestHash,
        redactions: mapping,
        latencyMs: Date.now() - started,
        status: "error",
        detail: `provider ${provider.name} not configured`,
      });
      res.status(503).json({ error: `provider for ${model} is not configured` });
      return;
    }

    // 4. Call the provider with redacted content.
    let rawText: string;
    try {
      const result = await provider.complete({
        model,
        messages: redacted,
        maxTokens,
      });
      rawText = result.text;
    } catch (err) {
      const status = err instanceof ProviderError ? err.status : 502;
      await recordAudit({
        apiKeyId,
        model,
        requestHash,
        redactions: mapping,
        latencyMs: Date.now() - started,
        status: "error",
        detail: (err as Error).message,
      });
      res.status(status).json({ error: "provider request failed" });
      return;
    }

    // 5. Output validation on the untrusted model output (pre-restoration).
    const violations = validateOutput(rawText);
    const responseHash = hashJson(rawText);
    if (violations.length > 0) {
      const threats = [...new Set(violations.map((v) => v.rule))];
      await recordAudit({
        apiKeyId,
        model,
        requestHash,
        responseHash,
        detectedThreats: threats,
        redactions: mapping,
        latencyMs: Date.now() - started,
        status: "blocked",
        detail: `output validation failed: ${threats.join(", ")}`,
      });
      res.status(502).json({
        error: "response blocked by output filter",
        rules: threats,
      });
      return;
    }

    // 6. Restore the caller's own PII in the outbound text and return.
    const finalText = restorePii(rawText, mapping);

    await recordAudit({
      apiKeyId,
      model,
      requestHash,
      responseHash,
      redactions: mapping,
      latencyMs: Date.now() - started,
      status: "allowed",
    });

    res.status(200).json({
      model,
      message: { role: "assistant", content: finalText },
    });
  },
);
