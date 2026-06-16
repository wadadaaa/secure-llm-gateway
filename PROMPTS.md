# PROMPTS

This file records the prompts used to design and build the SecureLLM Gateway,
for transparency and reproducibility. It is intended to be direct and honest:
everything below reflects interactions and fixes that actually happened during
this build.

## Tools used

- **Claude Code** — the main coding tool. It scaffolded the repository, wrote and
  edited all source, tests, Docker files, and documentation, ran `typecheck` /
  `test` / `build`, and brought up the Docker stack used for runtime verification.
- **ChatGPT** — a second AI tool used for requirements decomposition, security
  review of the request pipeline, debugging guidance, and challenge-compliance
  review (e.g. checking that the test suite exercised the Appendix A corpus).

## Why multiple tools

Claude Code generated and edited the repository — it was the hands on the code.
ChatGPT was used to challenge and review security-sensitive behavior and
challenge compliance: it acted as an adversarial reviewer that questioned whether
the implementation actually satisfied the security requirements, rather than
producing code itself. Findings from ChatGPT were then turned into concrete fix
prompts that Claude Code executed.

## Same-file / same-solution-area touched by multiple tools

Two areas were shaped by both tools:

1. **`POST /v1/chat` pipeline (`src/routes/chat.ts`)**
   - Claude Code implemented the `/v1/chat` security pipeline.
   - ChatGPT, reviewing the pipeline, identified that the **provider-readiness
     check ran before prompt-injection detection** — so a malicious request
     returned `503` (provider not configured) instead of being blocked.
   - Claude Code then fixed the `/v1/chat` pipeline order (injection detection and
     PII redaction now run before the readiness check).

2. **Test suite (`tests/`)**
   - Claude Code initially created the unit tests (per-control suites + a
     route-level pipeline test).
   - ChatGPT identified that **Appendix A was not represented as a dedicated
     corpus fixture**, so individual adversarial entries could be dropped silently.
   - Claude Code then added `tests/fixtures/adversarialCorpus.ts` and
     `tests/adversarialCorpus.test.ts`, including a coverage-guard test asserting
     every required Appendix A id is present.

## Example prompts

**1. Code generation / project scaffolding** (verbatim — reproduced in full under
*First AI interaction* below):

> Build a production-grade TypeScript / Node.js / Express service called SecureLLM
> Gateway. […] Create a clean modular architecture with pure security functions
> that are easy to test. […] Do not over-engineer.

**2. Security review of the `/v1/chat` pipeline** (near-verbatim):

> I found a requirement bug in POST /v1/chat. Current behavior: when the provider
> key is missing, even an obvious prompt injection request returns
> `503 {"error":"provider for claude-3-5-sonnet is not configured"}`. Expected:
> prompt-injection detection must run before provider readiness checks. A
> malicious input must return 400 and create an audit log entry even when
> Anthropic/OpenAI is not configured.

**3. Debugging / fixing the provider-before-injection bug** (near-verbatim):

> Please fix the /v1/chat pipeline order. Required order: 1. auth, 2. rate limit,
> 3. request validation, 4. prompt-injection detection (if detected, return 400
> and audit-log the fired rule), 5. PII redaction, 6. provider readiness check (if
> provider missing, return 503 and audit-log error), 7. provider call, 8. output
> validation, 9. response restoration, 10. audit log. Add tests covering: an
> injection request returns 400 even when the provider is not configured, and a
> provider-missing benign request still returns 503.

**4. Appendix A fixture compliance** (near-verbatim, additional):

> Current tests do not include a dedicated Appendix A adversarial corpus fixture.
> The challenge requires the test suite to exercise every Appendix A entry
> (INJ-A/B/C/E and PII-D) and at least one variation per injection entry. Add a
> dedicated fixture file `tests/fixtures/adversarialCorpus.ts`, treat all
> adversarial strings as untrusted test data, and add a test that asserts all
> required Appendix A IDs are present so future refactors cannot drop cases.

## What AI output was rejected or rewritten

- **Rejected: malicious input returning `503` instead of `400`.** The initial
  `/v1/chat` implementation ran the provider-readiness check first, so a prompt
  injection with no provider configured returned `503 provider not configured`.
  This was rejected and rewritten: injection detection now runs before the
  readiness check and returns `400` with the fired rule written to the audit log,
  even when no provider key is present.
- **Rejected: incomplete test coverage of Appendix A.** The first test pass did
  not encode Appendix A as a mandatory fixture, so entries could be dropped
  without failing the suite. This was rejected and rewritten by adding the
  `adversarialCorpus` fixture + test plus a coverage-guard assertion over all
  required IDs.
- **Rejected: Docker `seed` script using `tsx`.** `npm run seed` originally ran
  `tsx`, a dev-only dependency absent from the production image, so it failed in
  Docker with `tsx: not found`. Rewritten so `seed` runs the compiled
  `node dist/scripts/seed.js` and `seed:dev` runs `tsx` for local use.

## What would be done with more time

- **Testcontainers integration tests** spinning up real Mongo + Redis to exercise
  auth lookup, the Redis sliding-window limiter, and audit persistence end-to-end
  (currently the rate limiter is tested with an in-memory fake store).
- **GitHub Actions CI** running `typecheck`, `test`, `build`, and `gitleaks` on
  every push/PR.
- **Stronger normalization for prompt-injection detection** before rule matching:
  Unicode homoglyph folding, zero-width-character stripping, and decoding of
  common encoding tricks, to reduce evasion of the current rule-based detector.

## First AI interaction

> Build a production-grade TypeScript / Node.js / Express service called SecureLLM Gateway.
>
> Core stack:
>
> * TypeScript with strict mode
> * Node.js + Express
> * MongoDB
> * Redis
> * Vitest
> * Docker + docker-compose
> * One real LLM provider integration: OpenAI or Anthropic
>
> Required endpoints:
>
> 1. POST /v1/chat
>     * Requires x-api-key
>     * Accepts:
>         {
>         “model”: “claude-3-5-sonnet | gpt-4o”,
>         “messages”: [{“role”: “user”, “content”: “…”}],
>         “max_tokens”: 1024
>         }
>     * Runs full security pipeline before calling the provider.
> 2. GET /v1/audit
>     * Admin only
>     * Returns audit log entries since timestamp
>     * limit <= 500
> 3. GET /healthz
>     * No auth
>     * Reports Mongo reachability, Redis reachability, and provider readiness.
>     * If provider API key is missing, service should still start, but /v1/chat should return 503.
>
> Mandatory security controls:
>
> * Authentication:
>     * x-api-key required
>     * API keys stored hashed in Mongo
>     * Roles: client and admin
>     * Only admin can access /v1/audit
>     * Prefer constant-time API key comparison if practical
> * Rate limiting:
>     * Per API key sliding window in Redis
>     * Default 30 requests/min
>     * Configurable per key
> * Prompt injection detection:
>     * Inspect every incoming message
>     * Rule-based detection is acceptable
>     * Detect direct instruction override, forged system/admin role tokens, prompt/context extraction, secret exfiltration probes, DAN/persona hijack, interpreter roleplay, output format hijack, end-marker injection, HTML comment smuggling, multilingual bypass probes
>     * On detection: reject 400 and write audit log with the rule that fired
> * PII redaction:
>     * Redact inbound email, Israeli/international phone numbers, and Israeli national ID
>     * Redaction must happen before sending content to the LLM
>     * Use reversible token-based redaction, for example [REDACTED_EMAIL_1]
>     * Store token mapping in audit data, not in logs sent to stdout
> * Output validation:
>     * Treat LLM output as untrusted
>     * Block responses leaking secret-shaped strings:
>         * sk-…
>         * JWT-shaped strings
>         * AWS access keys
>     * Also block responses that echo known injection markers or bypass indicators
> * Audit log:
>     * Mongo record per request
>     * Include timestamp, API key ID, model, request hash, response hash, detected threats, latency, and status: allowed / blocked / error
> * Secrets handling:
>     * Provider keys via env vars only
>     * No hardcoded secrets
>     * No secrets in logs
>     * Include .gitleaks.toml
>
> Deliverables:
>
> * Source code
> * Dockerfile
> * docker-compose.yml with service + Mongo + Redis
> * README.md
> * PROMPTS.md
> * Unit tests for each security control:
>     * auth
>     * rate limiting if feasible
>     * prompt injection detection
>     * PII redaction
>     * output validation
>
> Implementation strategy:
> Create a clean modular architecture with pure security functions that are easy to test.
>
> Suggested structure:
> src/
> app.ts
> server.ts
> config/env.ts
> db/mongo.ts
> db/redis.ts
> models/ApiKey.ts
> models/AuditLog.ts
> middleware/auth.ts
> middleware/rateLimit.ts
> middleware/audit.ts
> routes/chat.ts
> routes/audit.ts
> routes/healthz.ts
> security/detectInjection.ts
> security/redactPii.ts
> security/validateOutput.ts
> security/hash.ts
> providers/provider.ts
> providers/openai.ts
> tests/
>
> Please start by:
>
> 1. Creating the project structure.
> 2. Implementing the core security pure functions first.
> 3. Adding Vitest tests for those functions.
> 4. Then wiring Express middleware and routes.
> 5. Then adding Docker, README, PROMPTS.md, and .gitleaks.toml.
>
> Do not over-engineer. Prefer a working, defensible implementation over a large incomplete one.
>
> Also create PROMPTS.md with a section called “First AI interaction” and include this exact prompt as the first interaction.

## Untrusted-input handling

The first prompt (reproduced verbatim above) did **not** contain an Appendix A
safety warning — it has not been edited to look safer than it was. The adversarial
handling was applied later, when the corpus was encoded:

- Appendix A strings are treated as **adversarial, untrusted test data**, not as
  instructions to follow.
- They are encoded as fixtures in `tests/fixtures/adversarialCorpus.ts` and only
  ever passed as input to the pure detection / redaction functions and asserted
  against.
- They are never executed, never used to build a prompt, and never sent to a real
  provider.

## Verification performed

Latest results from this build session:

- `npm run typecheck` — passed (exit 0).
- `npm test` — passed: **9 test files, 116 tests**.
- `npm run build` — passed (exit 0).
- **Docker** (`docker compose up --build`, gateway + Mongo + Redis):
  - `GET /healthz` → `200` with `{"mongo":true,"redis":true,"providers":{"anthropic":false,"openai":false},"providerReady":false}`.
  - **Malicious** `POST /v1/chat` (injection, no provider key) →
    `400 {"error":"request blocked by prompt-injection filter","rules":["instruction_override","prompt_extraction"]}`.
  - **Benign** `POST /v1/chat` without a provider key →
    `503 {"error":"provider for claude-3-5-sonnet is not configured"}`.
  - **Admin** `GET /v1/audit` → `200` with audit entries returned.
  - **Client** `GET /v1/audit` → `403 {"error":"admin role required"}`.

These runtime checks were run live against the Docker stack in this session (curl
against `localhost:8080`).

## Design notes / decisions made during the build

- **Provider choice.** Anthropic is the primary real integration (`@anthropic-ai/sdk`);
  OpenAI is also wired in via REST so the `gpt-4o` alias works. The request
  routes to a provider by model-alias prefix.
- **Model aliases.** The literal alias `claude-3-5-sonnet` is a retired upstream
  model id, so it is resolved to a currently-valid model (`ANTHROPIC_MODEL`,
  default `claude-sonnet-4-6`). The public API contract from the prompt is kept
  exactly; only the internal provider model id differs and is configurable.
- **Pure security core.** `security/*` functions have no I/O so they are directly
  unit-tested; the rate-limit algorithm takes an injected Redis-like store and is
  tested with an in-memory fake (no Redis needed in CI).
- **Fail closed.** If Redis is unavailable the rate limiter returns 503 rather
  than allowing unbounded traffic.
- **PII reversal.** Redaction tokens are reversed in the outbound response so the
  caller still receives their own data, while the provider only ever sees tokens.
