# SecureLLM Gateway

A production-grade TypeScript / Node.js / Express service that puts a full
**security pipeline** in front of a real LLM provider. Every request is
authenticated, rate-limited, scanned for prompt injection, PII-redacted, sent to
the provider, and the response is validated before it ever reaches the client —
with a tamper-evident audit record per request.

## Stack

- **TypeScript** (strict mode) + **Node.js** + **Express**
- **MongoDB** — API keys (hashed) and audit logs
- **Redis** — per-key sliding-window rate limiting
- **Vitest** — unit tests for every security control
- **Docker** + **docker-compose** — service + Mongo + Redis
- **Anthropic** — the real LLM provider integration (OpenAI also wired in)

## Architecture

```
src/
  app.ts                 Express app assembly
  server.ts              bootstrap (connect Mongo/Redis, listen, graceful shutdown)
  config/env.ts          env-only configuration + supported model aliases
  db/mongo.ts            Mongo connection, indexes, ping
  db/redis.ts            Redis connection + ping
  models/ApiKey.ts       hashed API key storage + constant-time verification
  models/AuditLog.ts     audit record write + admin query
  middleware/auth.ts     x-api-key auth + admin role guard
  middleware/rateLimit.ts sliding-window limiter (pure core + express wrapper)
  middleware/audit.ts    resilient audit writer (no secrets to stdout)
  routes/chat.ts         POST /v1/chat — the security pipeline
  routes/audit.ts        GET  /v1/audit — admin only
  routes/healthz.ts      GET  /healthz — dependency + provider readiness
  security/hash.ts       sha256, constant-time compare  (pure)
  security/detectInjection.ts  rule-based injection detection  (pure)
  security/redactPii.ts  reversible token-based PII redaction  (pure)
  security/validateOutput.ts   secret/marker leak detection  (pure)
  providers/             provider abstraction + Anthropic + OpenAI
  scripts/seed.ts        create admin + client API keys
tests/                   one suite per security control
```

The `security/*` modules are **pure functions** with no I/O — they are the unit
of testing and the core of the design.

## Request pipeline (`POST /v1/chat`)

1. **Authenticate** the `x-api-key` (hashed lookup, constant-time compare).
2. **Rate limit** the key (Redis sliding window, default 30 req/min).
3. **Validate** the request body (model alias, messages, `max_tokens`).
4. **Injection detection** on every message → on a hit, `400` + audit (`blocked`).
   Runs before the readiness check so malicious input is rejected and audited
   even when no provider key is configured.
5. **PII redaction** (reversible tokens) before the content leaves the process.
6. **Provider readiness** — if the provider key is missing, return `503` + audit (`error`).
7. **Provider call** with redacted content.
8. **Output validation** on the raw response → on a hit, `502` + audit (`blocked`).
9. **Restore PII** in the outbound text (the caller's own data) and return `200`.
10. **Audit** a record for every outcome: `allowed` / `blocked` / `error`.

## Endpoints

### `POST /v1/chat` — requires `x-api-key`

```jsonc
// request
{
  "model": "claude-3-5-sonnet",          // or "gpt-4o"
  "messages": [{ "role": "user", "content": "Hello" }],
  "max_tokens": 1024
}
// response
{ "model": "claude-3-5-sonnet", "message": { "role": "assistant", "content": "..." } }
```

| Status | Meaning |
|--------|---------|
| 200 | allowed |
| 400 | bad body **or** prompt-injection detected |
| 401 | missing / invalid key |
| 429 | rate limit exceeded |
| 502 | provider error **or** output validation failed |
| 503 | provider key not configured |

### `GET /v1/audit` — admin only

`GET /v1/audit?since=<ISO|epoch-ms>&limit=<n≤500>` → newest-first audit entries.
The PII token map is **never** returned.

### `GET /healthz` — no auth

Reports Mongo + Redis reachability and per-provider readiness. Returns `503`
when a hard dependency (Mongo/Redis) is down; a missing provider key is reported
but does **not** mark the service unhealthy (it still starts; `/v1/chat` 503s).

## Security controls

- **Auth** — keys are stored as SHA-256 hashes; lookup is by hash and confirmed
  with a constant-time comparison. Roles: `client`, `admin`. Only `admin` may
  read `/v1/audit`.
- **Rate limiting** — per-key Redis sorted-set sliding window; default 30/min,
  overridable per key (`rateLimitPerMin`). Fails closed if Redis is down.
- **Prompt-injection detection** — rule-based, covering instruction override,
  forged role tokens, prompt/context extraction, secret exfiltration, DAN/persona
  hijack, interpreter roleplay, output-format hijack, end-marker injection, HTML
  comment smuggling, and multilingual bypass probes. The rule that fired is
  written to the audit log.
- **PII redaction** — reversible tokens (`[REDACTED_EMAIL_1]`, `…_PHONE_…`,
  `…_ID_…`) for email, Israeli + international phone numbers, and checksum-valid
  Israeli national IDs. Redaction happens **before** the provider call; the token
  map is stored in the audit record, never logged to stdout.
- **Output validation** — blocks responses leaking provider secret keys, JWTs, or
  AWS access key IDs, or echoing known injection markers.
- **Audit log** — one Mongo record per request: timestamp, API key id, model,
  request hash, response hash, detected threats, latency, and status.
- **Secrets** — provider keys come from env vars only; none are hardcoded or
  logged. A `.gitleaks.toml` guards against committing secrets.

> **Model aliases.** The public alias `claude-3-5-sonnet` (per the API spec) is a
> retired upstream model id, so it is resolved to a currently-valid model via
> `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`). `gpt-4o` maps to `OPENAI_MODEL`.
> The public API contract is unchanged.

## Running

### With Docker Compose

```bash
cp .env.example .env          # set ANTHROPIC_API_KEY (or OPENAI_API_KEY)
export ANTHROPIC_API_KEY=""    # paste your real key here (never commit it)
docker compose up --build

# seed API keys (run once, prints the raw keys)
# `npm run seed` runs the compiled script (node dist/scripts/seed.js) — tsx is
# a dev-only dependency and is not present in the production image.
docker compose exec gateway npm run seed
```

### Locally

```bash
npm install
cp .env.example .env          # fill in keys + Mongo/Redis URIs
npm run seed:dev              # prints an admin key and a client key (tsx, no build)
npm run dev                   # or: npm run build && npm start
# in a built tree, `npm run seed` runs the compiled node dist/scripts/seed.js
```

### Example

```bash
# health
curl localhost:8080/healthz

# chat (client key)
curl -s localhost:8080/v1/chat \
  -H "x-api-key: $CLIENT_KEY" -H 'content-type: application/json' \
  -d '{"model":"claude-3-5-sonnet","messages":[{"role":"user","content":"Hi"}],"max_tokens":256}'

# audit (admin key)
curl -s "localhost:8080/v1/audit?limit=20" -H "x-api-key: $ADMIN_KEY"
```

## Tests

```bash
npm test          # vitest run
npm run typecheck # tsc --noEmit
```

Suites: `hash`, `auth`, `rateLimit`, `detectInjection`, `redactPii`,
`validateOutput`. The security functions are pure, so the tests need no Mongo or
Redis; the rate-limit test drives the algorithm with an in-memory fake store.

## Secret scanning

```bash
gitleaks detect --config .gitleaks.toml --source .
```
