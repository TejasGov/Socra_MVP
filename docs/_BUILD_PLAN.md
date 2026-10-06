# Engineering Contract (internal — read before writing code)

Every agent working on this repo must read: `docs/_TASK_SPEC.md` (top priority), this file, and the PRD sections relevant to its work. Pipeline/AI-strategy details are in `docs/_source_digest.md`. UI agents must also read `docs/DESIGN_GUARDRAILS.md`.

## Environment facts

- Windows 11 host, Git Bash + PowerShell available. Node 24 installed (code must work on Node 22+). Docker Desktop 28 running (Linux engine, 16 CPUs, 16 GB).
- Pinned versions (checked 2026-10-06): next 16.3.x, prisma/@prisma/client 7.10.x (pin `~7.10.0`, NEVER 8), bullmq 6.x, openai 7.x, tailwindcss 4.x, @playwright/test 1.63.x, vitest 5.x. Check `npm view` before adding anything else; use exact/tilde pins.
- Prisma 7 specifics: uses `prisma.config.ts`, the `prisma-client` generator with explicit `output`, and a driver adapter (`@prisma/adapter-pg`). Verify against the installed package's docs/types rather than memory.
- Host ports (avoid clashing with a local Postgres/Redis): Postgres **5544**→5432 (image `pgvector/pgvector:pg17`), Redis **6390**→6379 (`redis:7-alpine`). App on 3000.

## Repository layout (ownership boundaries)

```
src/
  app/                      Next.js App Router (UI + route handlers ONLY; thin)
    (public)/login, how-socra-works
    (student)/home, courses/[courseId]/..., practice, profile, privacy
    (faculty)/faculty/...
    (admin)/admin/..., research/...
    api/...                 route handlers: parse (zod) -> authorize -> call domain service -> respond
  server/                   ALL business logic (server-only; import 'server-only')
    env.ts                  zod-validated env; derives AI_MOCK_MODE
    db.ts                   Prisma client singleton (adapter-pg)
    auth/                   session.ts, local-provider.ts, oidc-provider.ts, rbac.ts (policy functions)
    events/                 taxonomy.ts, envelope.ts, outbox.ts (writeEvent(tx, ...)), consumers/
    flags/                  feature flags (env + course scope)
    audit/                  audit log writer
    ai/                     types.ts (AiProvider, AiRequestEnvelope), gateway.ts, providers/mock.ts, providers/openai.ts,
                            modes/<mode>.ts (policy, context rules, promptVersion, output handling), policy-check.ts, cost.ts, schemas.ts
    runner/                 types.ts (CodeRunner), docker-runner.ts, harness/<lang>, queue.ts
    domain/
      courses/ assignments/ (state-machine.ts, service.ts) workspace/ (drafts, runs) submissions/ grading/
      socra/ (sessions, budget, intervention) resources/ (ingest, chunk, retrieve) practice/
      learner/ (evidence.ts, topic-state.ts algorithm) knowledge-graph/ misconceptions/
      analytics/ (metrics.ts pure functions, aggregate.ts jobs, queries.ts) research/ (pseudonym, conditions, export)
      training/ (curation, dataset export, heldout) admin/ (roster import, model config) retention/
  components/               React UI (ui/ primitives, feature components). No business logic.
  lib/                      client-safe utilities (no secrets)
worker/                     index.ts: BullMQ worker process (outbox dispatcher, code-run queue, embeddings, aggregation, exports, retention) + health server
prisma/                     schema.prisma, migrations/, seed/ (index.ts + generators)
tests/                      unit/, integration/, e2e/ (Playwright)
docker/                     runner images / Dockerfiles
```

Rules:

- Route handlers and server components call `src/server/**`. React components never touch Prisma.
- Every privileged path authorizes server-side via `src/server/auth/rbac.ts` (role + course membership + ownership). Never rely on hidden buttons.
- Domain writes that produce events use `prisma.$transaction(async tx => { domainWrite(tx); await writeEvent(tx, envelope) })` (transactional outbox). Consumers are idempotent (processed-event table keyed by eventId/idempotencyKey + consumer name).
- Hidden tests: only `src/server/runner` and `src/server/domain/grading` may read them. Any DTO sent to client or AI context for students must use explicit select/allowlist mappers.
- Raw Socra messages live in the conversation domain tables; analytics code must never select message content. Raw-transcript access is a separate endpoint requiring a privileged permission + reason + AuditLog entry.
- `trainingEligible` defaults false everywhere.
- Zod at every boundary (HTTP input, AI structured output, env).
- No `any` without a justified comment. TypeScript strict.

## Scripts (package.json)

`dev` (next + worker concurrently), `build`, `start`, `worker`, `lint`, `typecheck`, `test` (vitest unit+integration), `test:unit`, `test:integration`, `test:e2e` (playwright), `db:migrate` (prisma migrate deploy for users; dev uses `db:migrate:dev`), `db:seed`, `db:reset`, `runner:pull` (pull/build runner images), `format`.

## Key decisions (record in docs/ASSUMPTIONS.md)

- Auth: own DB-backed sessions (httpOnly, secure-in-prod, SameSite=Lax cookie, random 32-byte token, SHA-256 hashed in DB), bcryptjs password hashing (pure JS, no native build on Windows), CSRF: SameSite + Origin check on mutating route handlers. OIDC via `openid-client` adapter, enabled when OIDC_* env present.
- Editor: CodeMirror 6 (`@uiw/react-codemirror` + language packages). Accessible, light.
- Streaming Socra: route handler returning `text/event-stream`.
- Code runs: Next route enqueues on BullMQ `code-runs` queue; worker runs `docker run` with the restrictions; route waits for completion with timeout (QueueEvents) and returns result; if worker/Docker unavailable → explicit `RUNNER_UNAVAILABLE`, never fabricated output.
- Embeddings: 1536-dim `vector(1536)` column via raw SQL migration (Prisma `Unsupported`). Mock mode: Postgres full-text (`tsvector`) + keyword scoring.
- Analytics: worker/aggregation job writes aggregate tables; seed calls the same aggregation function synchronously so dashboards are populated at startup. Small-n threshold from env.
- Learner model: see `src/server/domain/learner/topic-state.ts` and documented formula.
- OpenAI: Responses API (`client.responses.create` / `.stream`), `store: false`, structured outputs via JSON schema (zod -> json schema), usage from `response.usage` (incl. cached tokens).
- Model routing: PROTECTED_ASSESSMENT/POST_ASSESSMENT_REVIEW/FACULTY_AUTHORING → OPENAI_PROTECTED_MODEL; PRACTICE generation, classification, analytics brief → OPENAI_ECONOMY_MODEL.

## Progress tracking

Each agent appends a dated section to `docs/BUILD_STATUS.md` (what's done, what's partial, blockers) and decisions to `docs/ASSUMPTIONS.md`. Keep entries factual.
