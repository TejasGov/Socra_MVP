# Build status

## 2026-10-06: Foundation agent

Done and verified:

- **Scaffold**: Next 16 App Router, TypeScript strict, Tailwind v4, ESLint flat config, Prettier, Vitest (unit and
  integration projects), Playwright config, `@/*` alias.
- **Infra**: docker-compose (pgvector pg17 on 5544, Redis 7 on 6390, healthchecks, optional `app` profile), Dockerfile
  (standalone web plus bundled worker), .dockerignore, CI workflow.
- **Schema**: complete Prisma schema covering all planes, with 2 migrations. The init migration runs
  `CREATE EXTENSION vector`; the second adds raw SQL for HNSW, tsvector/GIN and append-only triggers.
  `npm run db:migrate` was verified on a fresh database.
- **Server modules** (`src/server`): env, db, redis, queues, http helpers, health, auth (session, local, OIDC adapter,
  rbac, rate limit, current-user), audit, flags, events (taxonomy, envelope, outbox, dispatcher, consumer registry,
  pseudonyms).
- **Contracts**:
  - `src/server/ai/types.ts`, with a deterministic MockAiProvider stub and a provider/routing stub.
  - `src/server/runner/types.ts`, with a stub runner that returns RUNNER_UNAVAILABLE.
- **Worker**: outbox loop, BullMQ workers for 7 queues (processor registry still empty), health server on :3001.
- **Routes and pages**:
  - API routes: /api/auth/login, /api/auth/logout, /api/auth/oidc/start, /api/auth/oidc/callback, /api/me,
    /api/health.
  - Login page, role-aware shell, placeholder pages for the student, faculty, admin and research areas, and the
    AI MOCK MODE indicator.
- **Seed** (idempotent, modular): 35 users, 2 courses with sections and memberships, topic graph (15 topics, 19 edges),
  43 study participants with pseudonym mappings, model configs, course budgets, retention policies.
- **Tests**: 59 passing. Unit: rbac, env, flags, events. Integration against docker Postgres: outbox, auth.
- **Checks**: lint, typecheck, test and build pass. Dev login verified with curl for student1 and faculty.

Not done, left for other agents:

- OpenAI provider, gateway and mode policies; Docker runner and harnesses; all domain services and the real UI.
- No consumers or queue processors are registered yet (`src/server/events/consumers/index.ts`,
  `worker/processors.ts`).
- E2E specs exist (`tests/e2e/auth.spec.ts`) but have not run: Playwright 1.63 Chromium is not installed on this
  machine. Run `npx playwright install chromium` once.
- Prisma refuses `npm run db:reset` (prisma migrate reset --force) when an AI agent runs it without explicit user
  consent. It works when a person runs it.

## 2026-10-06 Agent F (design system)

- Phase 1 ready: tokens in `src/app/globals.css` (guardrails §4, light default, dark via `data-theme="dark"`), IBM Plex Sans/Mono via next/font, UI primitives in `src/components/ui` (barrel `index.ts`). Prop reference: `docs/UI_PRIMITIVES.md`.

## 2026-10-06 Agent E (RAG/practice)
- Resources: chunker, ingest (txt/md, versioning), course-scoped FTS/hybrid retrieval, embeddings job (worker/processors.ts), /api/resources, /faculty/materials.
- Practice: logic (answer checking, adaptation, selection), service with tiered selection and live generation via runAi, /api/practice/*. Tests: tests/unit/{chunker,practice-logic}.test.ts, tests/integration/resources-practice.test.ts.

## 2026-10-06 Agent G (workspace, Socra panel, practice UI)
- /courses/[courseId]/assignments/[assignmentId]: mode banner (status, due, draft save state, attempts left), CodeMirror editor (Python/JS/Scala), written and multiple-choice editors, question switcher, debounced autosave with local recovery and 409 conflict resolution, Run and Run public tests console, submit dialog with idempotent POST /api/submissions, and a submission confirmation.
- Socra panel (src/components/socra): SSE streaming via fetch, labelled log turns, guidance depth L0–L6, citations, context disclosure, limit and unavailable states, Stop control, and review/practice modes.
- /practice and /practice/[sessionId]: topic picker that lists needs-reinforcement topics first, item types (multiple choice, short answer, trace, explain, code), feedback with the honest difficulty change, Explain this, self-assessment, finish summary, and a PRACTICE Socra panel.

## 2026-10-06 — Agent B (runner)
- Done: DockerRunner (src/server/runner/docker-runner.ts), RemoteRunner client + HTTP contract (remote-runner.ts), executeRun (service.ts), worker processor (worker/jobs/code-run.ts, registered in worker/processors.ts), POST /api/runs, images (docker/runner/*, scripts/runner-pull.mjs).
- Verified: unit tests (arg builder flags, truncation, hidden stripping, comparators, Scala protocol) and integration tests (real containers: Python, JS, Scala hello/tests/timeout/output cap/OOM/no-network). Queue path verified with a BullMQ worker; RUNNER_UNAVAILABLE returned when no worker is attached.
- Latency (Docker Desktop, Windows): Python run ~0.8s, JS run ~0.55s, Scala run ~4.4s cold per container, Scala 2 function tests ~13s (compile + JVM), Scala stdio test ~8s.

## 2026-10-06 Agent C (assignments, workspace, submissions, grading, faculty authoring UI)
- Done: state machine (pure, exhaustive unit tests), authoring service (create/update/publish snapshot/close/reopen/release/archive, audited), student queries + context + drafts + runs, idempotent submissions, grading (runner via executeRun, weighted score, rubric, override audit, PENDING_RUNNER retry, AI suggestion on demand), routes, faculty pages (list, new/edit with copilot + policy test, preview, submissions, grading).
- Verified: unit tests, integration test tests/integration/assignments-submissions.test.ts against docker DB (idempotency incl. concurrent, attempt limit, hidden-test non-leakage, runner-down path, override audit, close/release/reopen).
- Not verified: browser rendering of the faculty pages and the copilot route (/api/faculty/copilot and /policy-test were not present when written; the form tolerates their absence).

## 2026-10-06 Agent D (learning evidence, learner model, analytics, training, retention, faculty analytics UI)
- Done: learner model ltm-v1 (pure, docs/LEARNER_MODEL.md), evidence consumers (submission/grade, practice, Socra usage, intervention level, misconception) registered in src/server/events/consumers, misconception mapping with PENDING candidates, knowledge-graph recursive CTEs, analytics metrics + aggregation job (worker every 5 min, on demand, on first view), analytics queries/APIs, learner profile API, training curation + dataset versions with held-out exclusion, retention job (dry run by default), faculty pages /faculty, /faculty/analytics, /faculty/insights, question and topic drilldowns. docs/ANALYTICS_DICTIONARY.md.
- Verified: unit tests (learner model, metrics incl. small-n, training curation) and integration test tests/integration/learning-evidence.test.ts (student A vs B evidence, replay idempotency, rebuild equivalence, misconception candidates, aggregation) against docker Postgres. recomputeAggregates ran on the dev DB (seed was still empty of submissions at the time).
- Not verified: browser rendering of the faculty pages with seeded data.

## 2026-10-06 Agent A (AI gateway, Socra, faculty AI)
- Done: gateway (`src/server/ai/gateway.ts`: runAi/streamAi/embedTexts, task-tier routing, timeout + one transient retry, zod structured output via z.toJSONSchema (strict) with one retry -> INVALID_OUTPUT, AiRequest persistence incl. cost from `cost.ts`), OpenAiProvider (Responses API create/stream, store:false, cached/reasoning token counts, embeddings), deterministic MockAiProvider per mode, five mode modules, protected output policy check with PolicyDecision rows, Socra sessions/messages/budget/escalation/citations/events, authoring-ai (copilot, policy preview, written-grade suggestion, teaching brief with number validation), routes under /api/socra and /api/faculty/{copilot,copilot/policy-test,brief}.
- Verified: typecheck of owned paths, eslint, 35 unit tests (tests/unit/ai), integration test tests/integration/ai-gateway.test.ts, and a manual end-to-end run of session -> 3 turns -> transcript 403 for faculty -> copilot -> policy test -> brief against the dev DB (temporary fixture, removed).
- Not verified: real OpenAI calls (no key), browser SSE rendering.
- Phase 2 (Agent F): sidebar shell in `src/app/_shell` (role-aware nav per area, student course list + recent sessions, faculty course switcher writing `?courseId=`, user menu with sign-out and area switch, AI MOCK MODE badge, mobile menu, skip link). Pages: /login, /home, /courses, /courses/[courseId], /profile, /history, /how-socra-works (moved from (public) into (student) so it has the shell), /privacy, student loading/error boundaries. Verified via curl as student1 and faculty (all 200).
