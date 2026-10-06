# Cross-agent contracts (BINDING — do not rename; if you own one, create it FIRST, within your first 10 minutes, even as a typed stub)

Already exist (foundation): `src/server/ai/types.ts` (AiProvider, AiRequestEnvelope, AiTask, InterventionLevel…), `src/server/ai/provider.ts` (getAiProvider, TASK_TIERS, modelForTier), `src/server/runner/types.ts` + `index.ts` (CodeRunner, getCodeRunner, toStudentRunResult, runnerUnavailable), `src/server/events` (writeEvent(tx,input), recordEvent, pseudonymFor), `src/server/auth/current-user.ts` (requireUser, requirePageUser, requireArea), `src/server/auth/rbac.ts` (can, assertCan, PERMISSIONS, AuthError), `src/server/http.ts` (route, json, errorResponse, parseJson, assertSameOrigin, HttpError), `src/server/flags` (isEnabled), `src/server/audit` (writeAudit), `src/server/queues.ts` (getQueue, getQueueEvents, QUEUE_NAMES), `src/server/env.ts`. READ these files before using them; do not guess signatures.

## Owner map (only edit files you own; read anything)
| Agent | Owns |
|---|---|
| A — AI/Socra | src/server/ai/** (except types.ts additive only), src/server/domain/socra/**, src/server/domain/authoring-ai/**, src/app/api/socra/**, src/app/api/faculty/copilot/**, src/app/api/faculty/brief/** |
| B — Runner | src/server/runner/**, docker/runner/**, scripts/runner-pull.mjs, worker/jobs/code-run.ts, src/app/api/runs/** |
| C — Work/Submit/Grade | src/server/domain/workspace/**, src/server/domain/submissions/**, src/server/domain/grading/**, src/server/domain/assignments/**, src/app/api/drafts/**, src/app/api/submissions/**, src/app/api/assignments/**, src/app/api/grading/**, src/app/(faculty)/faculty/assignments/**, src/app/(faculty)/faculty/grading/** |
| D — Learning/Analytics | src/server/domain/learner/**, src/server/domain/misconceptions/**, src/server/domain/analytics/**, src/server/domain/knowledge-graph/**, src/server/domain/training/**, src/server/domain/retention/**, src/server/events/consumers/** (registration), worker/jobs/aggregate.ts, worker/jobs/retention.ts, src/app/api/analytics/**, src/app/api/learner/**, src/app/(faculty)/faculty/(page.tsx, analytics/**, insights/**) |
| E — RAG/Practice | src/server/domain/resources/**, src/server/domain/practice/**, worker/jobs/embeddings.ts, src/app/api/resources/**, src/app/api/practice/**, src/app/(faculty)/faculty/materials/** |
| F — Design system + student shell | src/app/globals.css, src/app/layout.tsx, src/app/_shell/**, src/components/ui/**, src/app/(public)/**, src/app/(student)/** EXCEPT the workspace and practice routes, src/app/page.tsx |
| G — Student workspace + practice UI | src/components/workspace/**, src/components/socra/**, src/components/practice/**, src/app/(student)/courses/[courseId]/assignments/[assignmentId]/**, src/app/(student)/practice/** |
| H — Admin/Research | src/server/domain/admin/**, src/server/domain/research/**, worker/jobs/export.ts, src/app/(admin)/**, src/app/api/admin/**, src/app/api/research/** |
| I — Seed | prisma/seed/** |
Shared files: `worker/index.ts` — each agent adds ONE import/registration line for its job file; edit with a minimal Edit, never rewrite. `src/server/events/consumers/registry.ts` — D owns; others call D's exported functions instead of registering consumers. `prisma/schema.prisma` — avoid changes; if unavoidable, additive only + `npm run db:migrate:dev -- --name <agent>_<desc>`; mention it in your report.
NEVER run `npm install`. Packages available beyond foundation: @uiw/react-codemirror, @codemirror/lang-python, @codemirror/lang-javascript, @codemirror/legacy-modes, @codemirror/language/view/state, lucide-react, papaparse, react-markdown.

## Function contracts
A — `src/server/ai/gateway.ts`:
```ts
runAi<T = unknown>(envelope: AiRequestEnvelope, opts: { task: AiTask; schema?: z.ZodType<T>; maxOutputTokens?: number }): Promise<{ ok: true; text: string; structured?: T; aiRequestId: string; model: string } | { ok: false; errorClass: AiErrorClass; message: string; aiRequestId: string }>
streamAi(envelope, opts: { task: AiTask }): AsyncIterable<AiStreamChunk>   // persists AiRequest on completion
```
Never throws for provider failures; persists AiRequest (usage, cost, latency, versions, status). Malformed structured output → retry once → `{ok:false, errorClass:'INVALID_OUTPUT'}`.
A — `src/server/domain/authoring-ai/index.ts`: `suggestAssignmentContent(user, { courseId, prompt, format, language, topicIds? }): Promise<AssignmentDraftSuggestion>` (title, description, learningObjectives[], topicSlugs[], questions[{prompt, starterCode, publicTests[], hiddenTestSuggestions[], rubric[], hintLadder[] (L0-L5 text), predictedMisconceptions[]}], scaffold[{stage:'PREDICT'|'TRACE'|'COUNTEREXAMPLE'|'REPAIR'|'EXPLAIN'|'REFLECT', instructions}]); `testSocraPolicy(user, {assignmentId, message}) → {reply, interventionLevel, policyOutcome}` (preview; NOT stored as student data); `suggestWrittenGrade(user, {submissionId, questionId}) → {suggestedPoints, maxPoints, rationale, evidence[], feedback, confidence}`; `generateTeachingBrief(user, {courseId, metrics: CourseOverview}) → {text, aiRequestId}` (model only receives computed metrics).
B — `src/server/domain/workspace/runs.ts` is C's; B exports from `src/server/runner/service.ts`: `executeRun(input: { runId: string; language; code: string; stdin?: string; tests: TestSpec[]; kind: 'RUN'|'PUBLIC_TESTS'|'GRADING' }): Promise<RunResult>` (enqueues on code-runs queue, waits with timeout; returns RUNNER_UNAVAILABLE result if worker/docker down — never fabricates).
C — `src/server/domain/workspace/context.ts`: `getWorkspaceContextForAi(userId, assignmentId, questionId?): Promise<{ assignment: AssignmentContext; workspace: WorkspaceContext; latestExecution: LatestExecutionContext | null; policy: PolicyContext; mode: 'PROTECTED_ASSESSMENT'|'POST_ASSESSMENT_REVIEW' }>` (PUBLIC test output only; hidden tests & reference solution excluded unless mode is POST_ASSESSMENT_REVIEW with solutions released, then reference solution included). `getEffectiveAiMode(userId, assignmentId)`; `src/server/domain/assignments/state-machine.ts`: `transition(state, action)` pure + `studentMode(assignment, progress)`.
C — student-facing queries in `src/server/domain/assignments/queries.ts`: `listCoursesForUser(user)`, `getCourseForUser(user, courseId)`, `listAssignmentsForStudent(user, courseId)` (card fields per PRD §10.2), `getAssignmentForStudent(user, assignmentId)` (prompt, questions, starter code, public tests, draft, latest run, submissions, mode, deadlines — NO hidden tests).
D — `src/server/domain/learner/index.ts`: `recordEvidence(tx, input)`, `recomputeTopicStates(userId, courseId)`, `recomputeAllTopicStates()`, `getLearnerProfile(userId, courseId)` → topics[{topicId, name, state, trajectory, confidence, evidenceCount, lastDemonstratedAt, commonDifficulty, suggestedAction}].
D — `src/server/domain/analytics/index.ts`: `recomputeAggregates(courseId?)`, `getCourseOverview(user, courseId)`, `getAssignmentAnalytics(user, assignmentId)`, `getQuestionDrilldown(user, questionId)`, `getTopicDrilldown(user, topicId)`, `getMisconceptionPatterns(user, courseId)`. Every metric value: `{ numerator, denominator, value: number | null, suppressed: boolean }` (suppressed when denominator < ANALYTICS_SMALL_N_THRESHOLD). Never select AiMessage.content.
D — event consumers: on `submission_completed`, `deterministic_grade_completed`, `faculty_grade_finalized`, `practice_answered`, `socra_response_completed`/`intervention_level_assigned`, `misconception_observed` → write LearningEvidence (idempotent on sourceEventId) → recompute topic state → emit `learner_topic_state_changed`.
E — `src/server/domain/resources/retrieve.ts`: `retrieveCourseResources({ courseId, query, allowedResourceIds?: string[] | null, topicIds?: string[], limit?: number }): Promise<RetrievedResource[]>` (course-scoped, FTS in mock mode, pgvector when embeddings exist). `ingestResource(user, {...})`.
E — `src/server/domain/practice/index.ts`: `startPracticeSession(user, {courseId, topicId?})`, `nextPracticeItem(user, sessionId)`, `submitPracticeAnswer(user, {sessionId, itemId, answer})` → {correct, feedback, explanation}, `requestExplanation(user, {sessionId, itemId})`, `completePracticeSession`.
H — `src/server/domain/research/export.ts`: `createResearchExport(user, {courseId?, assignmentId?, from?, to?, fields: string[], format: 'CSV'|'JSON'})`.

## HTTP contracts (route handlers; JSON unless noted; all use `route()` + zod + server-side authz)
- `POST /api/auth/login` {email,password}; `POST /api/auth/logout`; `GET /api/me` (foundation).
- `PUT /api/drafts` {assignmentId, questionId, content, baseVersion} → {version, savedAt} | 409 {serverVersion, content} (C)
- `GET /api/drafts?assignmentId&questionId` (C)
- `POST /api/runs` {assignmentId, questionId, code, stdin?, kind:'RUN'|'PUBLIC_TESTS'} → StudentRunResult (B builds route; persists CodeRun + events via C's `recordCodeRun` in `src/server/domain/workspace/runs.ts`, which C must export: `recordCodeRun(user, input, result)`)
- `POST /api/submissions` {assignmentId, idempotencyKey, answers:[{questionId, content}]} → {submissionId, attemptNumber, submittedAt, status} (C). Idempotent.
- `POST /api/socra/sessions` {assignmentId?, questionId?, practiceSessionId?, mode?} → {sessionId, mode, policySummary} (A)
- `POST /api/socra/sessions/:id/messages` {content, workspace?: {code, language}} → `text/event-stream`: `data: {"type":"delta","text":"..."}` … `data: {"type":"done","messageId","interventionLevel","citations":[{"resourceId","title","section"}],"limitReached":bool}` or `data: {"type":"error","code","message"}` (A)
- `GET /api/socra/sessions/:id` → own messages only (A). `GET /api/socra/transcripts/:sessionId?reason=` → privileged only (transcript:read_raw), audited (A). Faculty → 403.
- `POST /api/practice/sessions`, `POST /api/practice/sessions/:id/next`, `POST /api/practice/sessions/:id/answer`, `POST /api/practice/sessions/:id/explain`, `POST /api/practice/sessions/:id/complete` (E)
- `GET /api/learner/profile?courseId` (D); `GET /api/analytics/...` (D)
- Faculty assignment CRUD: `POST /api/assignments`, `PATCH /api/assignments/:id`, `POST /api/assignments/:id/{publish,close,reopen,release-solutions}` (C); `POST /api/faculty/copilot` (A)
- Grading: `GET /api/grading/assignments/:id/submissions`, `POST /api/grading/submissions/:id/finalize` (C)

## Routes (pages)
Student: `/home`, `/courses/[courseId]`, `/courses/[courseId]/assignments/[assignmentId]` (workspace; review mode when closed+released), `/practice`, `/practice/[sessionId]`, `/profile` (learning profile, course selector), `/how-socra-works`, `/privacy`.
Faculty: `/faculty` (overview dashboard), `/faculty/assignments`, `/faculty/assignments/new`, `/faculty/assignments/[id]/edit`, `/faculty/assignments/[id]/preview`, `/faculty/assignments/[id]/submissions`, `/faculty/grading/[submissionId]`, `/faculty/analytics`, `/faculty/insights/questions/[questionId]`, `/faculty/insights/topics/[topicId]`, `/faculty/materials`.
Admin: `/admin`, `/admin/{courses,roster,flags,ai,usage,audit,jobs,health}`; Research: `/research`, `/research/exports`, `/research/participants`.
Use `data-testid` on key controls for E2E: login-email, login-password, login-submit, editor, run-button, console-output, test-results, socra-input, socra-send, socra-message, submit-button, submission-confirmation, mode-banner, practice-start, practice-answer, practice-submit, profile-topic-row, create-assignment, copilot-generate, publish-button, close-assignment, preview-link, analytics-metric, question-drilldown-link.

## Rules for every agent
- Budget: ~60 minutes. Demo-critical paths first, working end to end; breadth second. Real logic, no hard-coded analytics numbers, no fake data in UI.
- Read the existing contract files before importing; never invent a function that "should" exist elsewhere — if it doesn't exist yet and you depend on it, check again later; if still absent at the end, implement a minimal version inside your OWN files and say so in your report.
- Typecheck only your area during work: `npx tsc --noEmit 2>&1 | grep -E "<your paths>"`. Other agents' in-progress errors are not yours to fix.
- UI agents: follow docs/DESIGN_GUARDRAILS.md strictly (tokens, no gradients/emojis/sparkles, plain copy, real empty/loading/error states). Use primitives from src/components/ui when they exist.
- Append a short dated entry to docs/BUILD_STATUS.md and decisions to docs/ASSUMPTIONS.md (append-only, small edits).
- Do not git commit. Report in ≤40 lines: files created, contracts implemented, what's verified, what's missing.

## Worker-safety rule (added by orchestrator)
Code reachable from `worker/**` must never import `@/server/auth/current-user`, `next/*`, or `react`. Use `@/server/auth/principal` (`loadPrincipal`, `CurrentUser` type) instead. `import type` from current-user is fine.
