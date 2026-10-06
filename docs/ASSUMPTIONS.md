# Assumptions and decisions

Append dated sections. Keep entries short and factual.

## 2026-10-06: Foundation (schema, auth, events, infra)

- **Versions**: next ~16.3.8, react ~19.3.0, prisma/@prisma/client/@prisma/adapter-pg ~7.10.0 (never 8), zod ~4.6.5,
  bullmq ~6.3.11, ioredis ~6.0.0, openai ~7.28.0, openid-client ~6.8.8, vitest ~5.0.3, @playwright/test ~1.63.0,
  tailwindcss ~4.3.3. TypeScript is ~6.0.3 and ESLint ~9.39.5 (not TS 7 / ESLint 10) because typescript-eslint 8.x
  requires TS below 6.1 and the eslint-config-next plugins require ESLint 9 or lower.
- **Prisma 7**: `prisma-client` generator with output `src/generated/prisma` (gitignored; generated on postinstall and
  build). `prisma.config.ts` loads `.env.local` then `.env`. Import from `@/generated/prisma/client` or
  `@/generated/prisma/enums`. `src/server/db.ts` exports a lazy `prisma` proxy, so importing it opens no connection and
  `next build` needs no database.
- **Assignment lifecycle**: assignment-level `AssignmentState` is DRAFT / SCHEDULED / PUBLISHED_PROTECTED / CLOSED /
  ARCHIVED. SUBMITTED and RETURNED are per student: they live on `AssignmentProgress.status` (NOT_STARTED / IN_PROGRESS /
  SUBMITTED / RETURNED / CLOSED) and `Submission.status`. Submitting never unlocks solutions. Review mode requires
  `state = CLOSED` and `solutionsReleased`.
- **Roles**: global `User.roles: Role[]` plus a per-course `CourseMembership.role` (STUDENT / TA / INSTRUCTOR).
  Course-scoped permissions check the membership role, never the global role alone.
- **Raw transcripts**: `transcript:read_raw` requires SYSTEM_ADMIN or RESEARCH_ADMIN, plus an unexpired, unrevoked
  `PrivilegedAccessGrant(TRANSCRIPT_READ_RAW)`, plus a reason of at least 10 characters. INSTRUCTOR and TA never qualify.
  Each read must write `TranscriptAccessLog` and `AuditLog("transcript.read_raw")`.
- **SYSTEM_ADMIN course overrides** are limited to course:read, roster management, assignment:read_staff and
  close/reopen (PRD 31). The admin role gives no grading or faculty-analytics access.
- **Sessions**: stored in the database. Cookie `socra_session` is httpOnly and SameSite=Lax, and Secure in production
  over https. The database stores HMAC-SHA256(token, SESSION_SECRET), never the raw token. TTL is `SESSION_TTL_HOURS`
  (12). CSRF defence is SameSite plus an Origin check (`assertSameOrigin`). Requests with no Origin or Referer are
  allowed only outside production (so curl works in dev).
- **Login rate limit**: Redis fixed window per ip+email (`RATE_LIMIT_LOGIN_PER_15_MIN`), with an in-memory fallback if
  Redis is down.
- **OIDC**: authorization code + PKCE through openid-client v6. Mapping order: an existing (issuer, sub) identity maps
  to its user; otherwise link by email to an existing user; otherwise create a STUDENT only if
  `OIDC_AUTO_PROVISION=true`; otherwise deny. The routes return 503 with an explanation until all OIDC\_\* vars are set.
- **Env**: `AI_MOCK_MODE` is derived. It is true when `OPENAI_API_KEY` is empty or `AI_MOCK_MODE=true`. Outside
  production, missing secrets fall back to dev defaults with warnings. Production requires SESSION_SECRET,
  RESEARCH_PSEUDONYM_SECRET, DATABASE_URL and REDIS_URL (not enforced during `next build`).
- **Feature flags**: precedence is COURSE row, then ENVIRONMENT row (scopeKey "env"), then the `FEATURE_*` env var. The
  seed creates no flag rows: env vars are the defaults and rows are explicit overrides.
- **Events**: names are snake_case (task spec). The envelope follows task 20 plus the data-pipelines fields
  (assignmentVersion, questionVersion, sectionId, sourceTraceId, privacyClass). An event is stored as QUARANTINED and
  never dispatched if any of these holds:
  - it is marked `requiresAssignmentVersion` and carries an assignmentId without an assignmentVersion;
  - its metadata fails the event's schema;
  - its metadata contains a forbidden key (content, code, prompt, token, email, referenceSolution, and so on).
- **Outbox**:
  - `writeEvent(tx, input)` inserts AnalyticsEvent + OutboxEvent with ON CONFLICT DO NOTHING on idempotencyKey, so a
    duplicate never aborts the caller's transaction.
  - The dispatcher claims rows with FOR UPDATE SKIP LOCKED and reclaims rows stuck in PROCESSING for over 5 minutes.
    The ledger is `ProcessedEvent(consumer, eventId)`.
  - Failures retry with exponential backoff from 1 s to 10 min. After `maxAttempts` (default 8) the row becomes FAILED
    and a `BackgroundJobFailure` row is written.
  - Claims use the app clock, not the database `now()`: the host and container clocks drifted under Docker Desktop.
- **Append-only at DB level** (triggers):
  - AuditLog and HeldOutEvalItem: no UPDATE or DELETE.
  - AnalyticsEvent: only status and quarantineReason may change.
  - LearningEvidence: only invalidatedAt and invalidationReason may change.
  - Retention jobs may delete after running `SELECT set_config('socra.retention_purge','on',true)` inside their
    transaction.
- **pgvector**:
  - `vector(1536)` columns on ResourceChunk.embedding and PracticeItem.embedding. They use Prisma `Unsupported`, so read
    and write them with raw SQL only.
  - HNSW cosine indexes on both, plus a trigger-maintained `tsvector` with a GIN index on ResourceChunk.
  - Prisma's differ does not model HNSW indexes. Create new migrations with
    `npm run db:migrate:dev -- --name x`, not plain `prisma migrate dev`: scripts/migrate-new.mjs strips the spurious
    DROP INDEX lines.
- **Pseudonyms**: `p_` + 24 hex chars of HMAC-SHA256("user:" + userId, RESEARCH_PSEUDONYM_SECRET). The identity mapping
  lives only in `ResearchParticipantMapping`.
- **Study conditions (seed)**:
  - student1-3 get SOCRATIC_AI.
  - Other students rotate by n mod 3: 0 is SOCRATIC_AI, 1 is UNRESTRICTED_AI, 2 is CONTROL.
  - A student has the same condition in both courses.
  - Every 10th student has DECLINED consent.
  - Re-seeding never changes an existing participant.
- **Seed enrollment**: CSE 115 has students 1-20 (sections A1 and A2). CSE 116 has students 1-3 and 11-30 (section B1).
  faculty teaches both courses, faculty2 teaches CSE 116, and ta assists both. All passwords are `socra-dev-password`.
- **Integration tests** use a separate `<db>_test` database on the docker Postgres. It is created and migrated by
  `tests/integration/global-setup.ts`.
- **Worker bundle**: `scripts/build-worker.mjs` (esbuild) writes `worker-dist/index.mjs`. `server-only` is aliased to a
  stub in the worker bundle and in vitest. In dev, tsx runs with `--conditions=react-server`.
- **Root layout is force-dynamic** so the AI MOCK MODE indicator reflects runtime env, not build-time env.

- (E) ResourceStatus READY is used as "indexed". Old chunk versions are kept; retrieval reads only the current version. STAFF_ONLY resources are never retrieved unless includeStaffOnly; ASSIGNMENT_SCOPED only when listed in allowedResourceIds.
- (E) PracticeItemAttempt.difficulty stores the session difficulty level served (used for the 2-correct/2-wrong streak); the item's own difficulty is in the event metadata (itemDifficulty).
- (E) Ungraded free-response answers emit practice_answered only after AI grading or student self-assessment (POST answer with attemptId + selfAssessedCorrect).
- (E) Practice reads LearnerTopicState directly (read-only) instead of importing D's getLearnerProfile.
- (G) Workspace: when an assignment is CLOSED/ARCHIVED, editors are read-only and autosave is off. Running code stays available, so review mode can still execute the student's last draft.
- (G) Multiple-choice answers in assignments are stored as the choice id (e.g. "b"), which matches answerKey.correct. The workspace page reads the student-safe `QuestionVersion.choices` column directly because `getAssignmentForStudent` drops object-shaped choices ([{id,text}]).
- (G) Autosave keeps a per-question localStorage buffer `socra:draft:<assignmentId>:<questionId>` ({content, baseVersion, updatedAt}). It is restored when newer than the server draft and then saved with the buffer's baseVersion, so a newer server copy produces a 409 and the student picks "Keep mine" or "Use saved". Submission idempotency keys live in sessionStorage `socra:submit-key:<assignmentId>` until a submission succeeds.
- (G) Socra panel: one AiSession per question (created lazily when the question is shown). Students send with Enter or Ctrl/Cmd+Shift+Enter, and Shift+Enter adds a newline. Ctrl/Cmd+Enter runs code. A 429 or a limit/budget error code shows the PRD §10.8 limit message. Every other failure shows "Socra is unavailable. You can keep working and submit normally." with Retry.
- (G) The guidance depth meter shows intervention levels 0 to 6 with student-facing labels, replacing the wireframe's "1 of 3 hints" meter (per coordinator).

## Runner (Agent B, 2026-10-06)
- Images are built locally by `node scripts/runner-pull.mjs` and tagged to the RUNNER_IMAGE_* defaults: socra-runner-python:1 (python:3.12-alpine), socra-runner-node:1 (node:22-alpine), socra-runner-scala:1 (virtuslab/scala-cli:latest, ~4.9GB, official Scala CLI image with Scala 3.9; compiler cache baked in at build time because sandboxes have no network).
- Code/harness travel on stdin (JSON for Python/Node, a base64-embedded shell script for Scala); no bind mounts or env vars. `/work` and `/tmp` tmpfs use mode=1777 so uid 65534 can write (do not add WORKDIR /work in the Dockerfiles: it makes the mount root-owned).
- Expected values are compared on the host and never enter the container; function-test results come back out-of-band (result file / nonce-tagged base64 markers) so student prints cannot forge them.
- stdio comparison: "exact" ignores only CRLF and trailing newlines; "normalized_whitespace" collapses whitespace runs. Function tests compare JSON values (1 == 1.0); non-JSON returns are compared by repr only when expectedReturn is a string.
- Scala gets min 768m memory and 1 cpu (256m OOMs the JVM). Scala function tests run in one JVM (no per-test timeout, only an overall one); Scala function-call args support JSON scalars/arrays/objects as List/Map.
- Top-level RunResult.stdout/stderr in tests mode contain PUBLIC test output only; hidden/diagnostic per-test details exist only in testResults and are removed by toStudentRunResult.
- Job payload (code + test specs incl. hidden expectations) is stored in server-side Redis for ~5 minutes after completion.

## Agent C decisions (2026-10-06)
- TestCase storage convention: input = {kind, entryPoint?, args?, stdin?}; expected = {returns?, stdout?}; harness = {comparator?, tolerance?}. Use testCaseToSpec/testInputToRow in src/server/domain/assignments/test-mapping.ts (flat TestSpec key names are also accepted when reading).
- Scoring: question points P, manual rubric criteria total R. Tests are worth P-R, weighted by test weight; rubric criteria are scored by faculty. No criteria on a coding question means FINAL deterministic grade; any criteria, written answers: SUGGESTED until faculty finalizes. Finalizing also returns (releases) the grade to the student.
- A deterministic FINAL grade is not shown to the student until faculty finalize/return it.
- Published assignments freeze content (AssignmentVersion snapshot); only dates, attempt limit, resubmission and release mode may change afterward.
- Reopen requires a reason, withdraws any solution release, and clears a past close date unless a new one is given.
- ON_CLOSE release only happens when the postAssessmentSolutions flag is on.
- Scheduled open/close transitions are applied lazily on read/submit (syncAssignmentState); no sweeper job required.
- Grading runs in next/server after() following the submission response; failures leave the grade PENDING (PENDING_RUNNER) and retry via POST /api/grading/submissions/:id/retry or retryPendingGrades().
- AI written-grade suggestion is requested by faculty on the grading page (needs a faculty user for authz), not automatically at submission time.
- Staff preview (getAssignmentForStudent for non-students) reads and writes no student data and emits no events.

## Agent D (learning + analytics), 2026-10-06
- A question attempt is "correct" only with full credit. Only authoritative grades count (FINAL, or system deterministic tests); AI grading suggestions never produce evidence or metrics.
- Course/assignment correctness metrics pool student-question pairs; question metrics are per student. Final correctness uses students with a graded attempt as the denominator (ungraded submissions would otherwise read as incorrect).
- Guided recovery "revised" = graded attempt after first Socra use plus a draft/answer change event after Socra or a changed answer hash.
- Socra sessions without a questionId are attributed to every question of their assignment.
- Active students = any event, submission or Socra session in the last 14 days. Weekly usage uses ISO weeks in UTC.
- Topic difficulty threshold per student 0.5; unresolved concept = ≥ 25% of students with a state currently Needs reinforcement; misconception analytics use detector confidence ≥ 0.6 and approved labels only.
- Unknown misconception labels become Misconception rows with source AI_PROPOSED, reviewStatus PENDING (no schema change); approving one backfills evidence from earlier observations.
- Retention defaults: raw AI messages are redacted (DEIDENTIFY), AI request logs/expired sessions/processed outbox rows/old audit rows deleted; identity, submissions, research and training are report-only. Nothing is applied unless RETENTION_ENFORCE=true.
- Training exports include only TRAIN-split, curated candidates (eligible + nine gates + APPROVED) and exclude held-out items by stored or recomputed content hash.
- The learner queue processor ({ userId, courseId } or { all: true }) is registered in worker/jobs/aggregate.ts since no separate learner job file is owned.

## Agent A (AI / Socra), 2026-10-06
- Protected-mode replies are generated as structured JSON, validated, policy-checked, and only then streamed to the client in chunks (buffered delivery). Practice and review stream live. Safety over first-token latency.
- Policy-check outcomes map to the PolicyOutcome enum as REDACT -> REVISE, BLOCK_AND_REGENERATE -> BLOCK. A block triggers one regeneration; a second block yields a safe fallback reply (outcome ESCALATE). The checker (`src/server/ai/policy-check.ts`) reads hidden tests and the reference solution server-side for comparison only; they never enter model context.
- The contract's `INVALID_OUTPUT` error class is stored as AiErrorClass `SCHEMA_VALIDATION`. On invalid output, Socra shows a deterministic Socratic fallback and no intervention level or misconception is recorded from it.
- UNRESTRICTED_AI condition: session mode stays PROTECTED_ASSESSMENT, prompt switches to direct help, policyVersion `unrestricted-direct-v1`, and only the hidden-test leak check applies. CONTROL condition, the protectedSocra flag being off, or the runtime kill switch all return "Socra is not available for this activity" (403 `socra_unavailable`).
- If postAssessmentSolutions is off, a closed and released assignment keeps protected mode.
- The kill switch is checked in the gateway and in Socra availability. It uses env AI_KILL_SWITCH or the FeatureFlag row `ai_kill_switch` with scope "env", the same semantics as admin `isAiKillSwitchOn()`. It is re-implemented in the gateway because `domain/admin/ai.ts` imports next/* through http.ts, and the gateway must stay worker-safe.
- Budget limits: per-session turns, per-user UTC-day turns, per-minute rate, course spend (CourseAiBudget, or the env budget for the current month). When the limit is reached, the student sees the exact PRD §10.8 text, the app emits `socra_limit_reached`, and session-turn exhaustion marks the session LIMIT_REACHED.
- Misconception candidates with confidence >= 0.6 go to D's `recordMisconceptionObservation` (detectionMethod LLM, PENDING review), which emits `misconception_observed`.
- The copilot response is `{ suggestionId, aiRequestId, suggestion }`. Tests follow C's TestCase convention (`input {kind, entryPoint, args}`, `expected {returns}`) plus flat aliases. `assignment_ai_generated` is emitted by C when an assignment is created from the suggestion, not by the copilot call.
- Teaching brief: every number in the model text must appear in the metrics (rounded percent forms of input values are allowed). Otherwise the app uses a deterministic template brief. Briefs are upserted per course per UTC week (Monday).
- Mock cached tokens: the system and developer prefix counts as cached once a conversation has history. This emulates prompt caching for the usage dashboards.
- **Agent F shell conventions**: faculty pages read `searchParams.courseId` (set by the sidebar course switcher) and default to the first course taught. Practice links use `/practice?courseId=&topicId=`. Pages needing full width (workspace with a right Socra panel) render an element with `data-shell-width="full"` to lift the 1200px content cap. `/how-socra-works` requires sign-in (lives in the student shell). Shell and home/history read AiSession titles/dates and the privacy page reads RetentionPolicy directly (trivial reads, marked in code).

- 2026-10-06 (security review): code-run job payloads are now deleted by the waiter as soon as the result arrives, with a 60 s removeOnComplete/removeOnFail fallback (supersedes the ~5 minute note above). Forwarded headers are trusted only with TRUST_PROXY=true. OIDC links by email only when email_verified is true.

## 2026-10-06: Real OpenAI configuration (owner decision)
- The owner chose `gpt-6-luna` for every tier (`OPENAI_PROTECTED_MODEL=gpt-6-luna` in `.env.local`). `.env.example` keeps the spec default (`gpt-6.1-sol` for the protected tier); switching is a one-line env change, no code change.
- Cost is priced by the model that actually ran (`pricingTierFor` in `src/server/ai/gateway.ts`), so a protected-tier request served by Luna is billed at economy rates.
- Measured on this machine: protected tutor turn ~11s on Sol vs ~2–4s on Luna; full quiz generation ~51s / $0.034 on Sol vs ~26s / $0.0017 on Luna. Luna's self-reported intervention level can understate how direct a hint is; run the protected-mode leakage evaluation before student use.
- Long generations (authoring, practice generation, grading suggestions) use `OPENAI_LONG_TIMEOUT_MS` (default 150s); tutoring turns keep `OPENAI_TIMEOUT_MS` (30s).
- After adding a key, run `npm run ai:embed` once to embed existing course materials and practice items (otherwise retrieval stays full-text only).
