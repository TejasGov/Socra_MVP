# SOCRA PILOT RESEARCH V1 — BUILD TASK (owner's instructions, verbatim intent)

> This is the highest-priority requirements source. Priority when requirements conflict:
>
> 1. This task 2. `docs/socra_pilot_research_v1_prd.md` 3. Data Pipelines paper (`docs/_source_digest.md`) 4. AI Strategy (`docs/_source_digest.md`) 5. Figma (see `docs/DESIGN_GUARDRAILS.md` inventory)
>    When a decision is missing, choose a conservative production-quality default, record it in `docs/ASSUMPTIONS.md`, and continue. Do not ask the owner questions.

Build the complete Socra Pilot Research V1: a functional end-to-end app (not prototype/mockup/scaffold), runnable locally, every external integration wired through env vars, fully working with NO paid credentials via deterministic mock adapters. Adding keys later activates real integrations without rewrites.

## 2. Definition of done

```
git pull
cp .env.example .env.local
docker compose up -d
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Then visit the app and use it, in credentialless dev mode.

Student: log in; access CSE 115 / CSE 116; view assignments; open coding assignment; edit code; autosave; run code; view stdout/errors; execute public tests; ask Socra; Socra automatically sees current code + assignment context; protected Socratic guidance; submit; see submission confirmation; practice mode; complete generated/cached practice questions; view topic learning profile (Needs Reinforcement / Developing / Consistently Demonstrated); open a closed assignment; full Review Mode where Socra may explain the complete solution.

Faculty: log in; faculty dashboard; create assignment; AI-assisted assignment creation; configure learning objectives; topic tags; starter code; tests; rubric; Socra protected-assistance rules; preview as student; publish; close; inspect submissions; grade coding submissions; approve subjective grading; class analytics; topic pain points; misconception patterns; first-attempt performance; post-guidance performance; hint/intervention depth; drill into questions; NEVER see raw private student Socra conversations through analytics.

Admin / researcher: view courses; manage roster; inspect feature flags; inspect AI configuration; inspect AI usage; inspect audit events; export approved pseudonymized research data; view job failures/system health.

## 3. Stack

Node 22+, TypeScript strict, latest stable Next.js (App Router), React, Tailwind CSS, PostgreSQL + pgvector, **Prisma ORM 7.x pinned (not 8 RC)**, Redis, BullMQ, Zod, official OpenAI JS SDK using the **Responses API**, Playwright, Vitest, Docker Compose. No RC frameworks. Business logic outside React components.

## 4. Local dev mode is mandatory

Runs without OpenAI key, university SSO, S3, production code execution provider, external analytics. When `OPENAI_API_KEY` is absent → `AI_MOCK_MODE=true`, UI shows a small `AI MOCK MODE` dev indicator. Mock AI is deterministic and realistic (Socratic). Missing key never crashes pages. With

```
OPENAI_API_KEY=
OPENAI_PROTECTED_MODEL=gpt-6.1-sol
OPENAI_ECONOMY_MODEL=gpt-6-luna
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

the real server-side OpenAI integration activates automatically. Key never reaches the browser.

## 5. Seeded users

student1@socra.local, student2@socra.local, student3@socra.local, faculty@socra.local, ta@socra.local, research@socra.local, admin@socra.local (credentials documented in README). Roles: STUDENT, TA, INSTRUCTOR, RESEARCH_ADMIN, SYSTEM_ADMIN. Authorization enforced server-side.

## 6. Auth

Abstraction supporting local dev auth (seeded accounts) and future university SSO via generic OIDC: `OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_REDIRECT_URI`. Adapter/routes/config exist and are documented even without real credentials.

## 7. Courses

CSE 115: Python, JavaScript. CSE 116: Python, Scala. Topic structures incl. variables, control flow, functions, lists, recursion, recursive base cases, call-stack tracing, asymptotic complexity, linked structures, trees, traversal.

## 8. Student assignment workspace

Coding + written assignments. Coding workspace: prompt, code editor, starter code, autosave, Run, console, compiler/runtime errors, public test results, Socra panel, submission controls, save status, assignment status. Socra automatically receives: prompt, learning objectives, topic tags, student code, latest execution result, public test output, current conversation, allowed course resources, Socra assignment policy. Student never copy/pastes code into Socra.

## 9. Assignment state machine

DRAFT, SCHEDULED, PUBLISHED_PROTECTED, SUBMITTED, CLOSED, RETURNED, ARCHIVED. Protected assistance stays active after submission if resubmission possible and not closed. Submission alone must NOT unlock solutions. When CLOSED and instructor releases solutions → `POST_ASSESSMENT_REVIEW` (complete explanations allowed).

## 10. Socra AI modes (strongly typed, not labels)

PROTECTED_ASSESSMENT, PRACTICE, POST_ASSESSMENT_REVIEW, FACULTY_AUTHORING, FACULTY_ANALYTICS. Each gets separate system policy, context rules, prompt version, logging, output handling.

## 11. Protected Socratic mode

Levels: L0 Orientation, L1 Socratic question, L2 Conceptual hint, L3 Diagnostic localization, L4 Related example/course reference, L5 Strong directional hint, L6 Escalation to TA/instructor. Track max level.
MAY: inspect code, run/interpret results, explain syntax/runtime errors, point to suspicious line, explain CS concept, analyze complexity, ask student to trace, analogous examples, retrieve lecture material, increasingly strong hints.
MUST NOT: reveal hidden tests, provide whole solution, rewrite target function, supply central missing algorithm, auto-fix student solution, reconstruct complete answer via sequential instructions. Mechanical syntax help may be more direct. Don't claim jailbreak-proof. Output policy-check hook; log policy decisions.

## 12. AI gateway

`interface AiProvider { generate(...); stream(...); embed(...) }` with `MockAiProvider`, `OpenAiProvider`. Every request carries: mode, userId, courseId, assignmentId, questionId, sessionId, researchCondition, promptVersion, policyVersion, workspace, latestExecution, retrievedResources, conversation. Persist: provider, model, request ID, timestamp, latency, input tokens, cached tokens, output tokens, cost estimate, prompt version, policy version, status, error classification, application version. Use Responses API.

## 13. Code execution

Never inside Next.js process. `interface CodeRunner`. Local runners: Python 3, Node JS, Scala 3. Disposable Docker: `--network none`, `--memory`, `--cpus`, `--pids-limit`, `--read-only`, timeout, output limit, ephemeral fs, no app secrets. Separate public / hidden / diagnostic tests. Hidden tests server-side only, never in client responses, never in normal student Socra context. Provider interface so a managed microVM/sandbox can replace Docker.

## 14. Course content + RAG

Faculty upload/add resources: record, text, metadata, topic tags, chunking, embedding, pgvector storage, course-scoped retrieval. No key → deterministic keyword/full-text retrieval. Key → configured embedding model. Socra cites resources it uses. Never retrieve from an unauthorized course.

## 15. Practice

Student-initiated. Hybrid: 1) faculty-authored question 2) cached/generated approved question 3) live generation. Practice can explain directly, give complete answers, worked examples, change difficulty, recommend follow-ups. Simple adaptation: repeated correct → harder; repeated errors → easier/scaffolded; prioritize Needs Reinforcement; avoid immediate repetition. No complex ML.

## 16. Learner data model

NOT a giant student vector. Append-only `LearningEvidence` (first-attempt correctness, final correctness, retry improvement, Socra usage, intervention depth, misconception observed, practice success, difficulty, assisted/unassisted, timestamp). Recomputable `LearnerTopicState`: NEEDS_REINFORCEMENT / DEVELOPING / CONSISTENTLY_DEMONSTRATED with state, trajectory, evidence count, sufficiency/confidence, last demonstrated, common difficulty, algorithmVersion, updatedAt. Interpretable V1 scoring: recency weighted, independent > heavily assisted, decay over time, minimum observations before Consistently Demonstrated, fully rebuildable from evidence. Document formula.

## 17. Knowledge graph

Relational in Postgres (no Neo4j). Nodes: Topic, LearningObjective, Misconception, Question, Resource. Topic relations: PREREQUISITE_OF, RELATED_TO, PART_OF, TRANSFER_TO. Recursive SQL where needed. Map questions→topics, misconceptions→topics, resources→topics, evidence→topics, practice items→topics.

## 18. Vector data

Embeddings for semantic resource retrieval, similar practice-item retrieval, optional misconception clustering, semantic content search. NOT primary proficiency. Every vector record points to source + version.

## 19. Data pipeline

Four logical planes: 1) transactional truth (users, courses, assignments, submissions, grades, drafts, code runs) 2) learning evidence (topic observations, misconceptions, assistance depth, topic state) 3) analytics/research (aggregates, pseudonymous research data, experiment condition) 4) model-improvement data (nothing enters automatically). Transactional outbox: domain record + outbox record in one DB transaction; worker processes asynchronously; idempotent processing.

## 20. Event taxonomy (minimum)

course_opened, assignment_opened, question_viewed, draft_saved, code_run_requested, code_run_completed, socra_session_started, socra_prompt_sent, socra_response_completed, socra_response_failed, intervention_level_assigned, course_resource_retrieved, socra_limit_reached, submission_started, submission_completed, deterministic_grade_completed, ai_feedback_generated, faculty_grade_finalized, practice_started, practice_item_shown, practice_answered, explanation_requested, practice_completed, misconception_observed, learning_evidence_recorded, learner_topic_state_changed, analytics_viewed, assignment_created, assignment_ai_generated, assignment_published.
Envelope: eventId, eventName, actorId/pseudonymousId, courseId, assignmentId, questionId, sessionId, occurredAt, receivedAt, schemaVersion, appVersion, researchCondition, idempotencyKey, metadata. No keystroke logging.

## 21. Faculty analytics

From stored evidence/events; never hard-coded. Aggregates: course, assignment, question, topic, misconception. Metrics: first-attempt correctness (correct on first valid attempt / with a first valid attempt); final correctness (correct finally / submitting); guided recovery (correct after Socra + revision / Socra users who revised); retry improvement (first vs later valid attempt); intervention depth (avg/max level); misconception prevalence (unique students with evidence / eligible students); completion (submitted / assigned). `docs/ANALYTICS_DICTIONARY.md` with every metric + denominator. `ANALYTICS_SMALL_N_THRESHOLD=5` → below threshold show `Insufficient data`.

## 22. Faculty dashboard

Active students, assignment completion, top class pain points, unresolved concepts, intervention depth, retry improvement, Socra usage, misconception patterns, assignment trend, question drilldown, topic drilldown. AI weekly teaching brief receives already-computed metrics only; may summarize, must not invent/calculate stats.

## 23. Faculty authoring

Coding assignment, written assignment, quiz. Fields: course, title, description, learning objectives, topic tags, format, programming language, starter code, public tests, hidden tests, rubric, due date, close date, attempts, Socra policy, resource scope, solution release. Copilot suggests: question, scaffold, misconception, learning objectives, rubric, public tests, hidden test suggestions, hint ladder, topics. AI output editable; nothing publishes automatically.

## 24. Grading

Coding: deterministic tests first, test weights, rubric, final points, instructor override, audited override. Written: AI may suggest feedback/rubric score; faculty must approve final subjective score. LLM never silently authoritative.

## 25. Training data

Never auto-use production student data. Default `trainingEligible=false`. Metadata: trainingEligible, trainingEligibilityReason, consentBasis, deidentifiedAt, reviewStatus, datasetSplit, sourceModelVersion, sourcePromptVersion. Eligibility requires: policy allowed, de-identification, PII/secret scan, hidden-test leakage check, copyright authorization check, quality review, dedup, train/eval contamination check, dataset version. Dataset-export job ONLY on explicitly curated eligible records. Permanent held-out eval dataset that training exports can never include.

## 26. Research pipeline

Pseudonymous participant ID, research condition, assignment version, question version, prompt version, model version, Socra policy version. Conditions: CONTROL, UNRESTRICTED_AI, SOCRATIC_AI. Never silently switch condition. Export: CSV, JSON, filters, pseudonymized IDs, field allowlist, audit log. `docs/RESEARCH_DATA_DICTIONARY.md`.

## 27. Privacy

Ordinary faculty analytics never expose raw chat, thought process, private history. Student transparency page: what Socra sees, what's stored, what updates learner state, what faculty see, what research use means, that faculty analytics don't expose transcripts. Log privileged raw-conversation access. Logically separate identity, learning records, raw conversations, research, aggregates. Configurable retention.

## 28. Admin

Course management, roster, role management, feature flags, AI model config, AI usage, job failures, system health, research exports, audit log, assignment reopen/close. Roster CSV import: upload, validate, preview, apply, duplicate detection, error report.

## 29. Feature flags

protectedSocra, practiceGeneration, learnerProfile, facultyAnalytics, individualAnalytics, aiGradingSuggestions, courseRag, postAssessmentSolutions, facultyAiAuthoring. At least environment + course scope.

## 30. Seed data

≥30 students, 2 faculty, 1 TA, 2 courses, 3+ assignments, 10+ questions, 8+ topics, 5+ misconception categories, 100+ learning evidence rows, 200+ analytics events, practice attempts, AI conversations, grades, code runs. Realistic synthetic. No dashboard requires manual data entry after startup.

## 31. Error handling

AI down: student can still edit/save/run/submit. Runner down: preserve work, show runner unavailable, never fabricate output. Connection loss: local recovery buffer + server autosave. Duplicate submission: idempotency. Malformed AI structured output: validate, retry safely, fallback, never store malformed inference as authoritative learning data.

## 32. Testing

Unit: authorization, state machine, grading, learner model, analytics calcs, event/outbox idempotency, feature flags, AI adapter, usage/cost accounting.
Integration: login, assignment load, autosave, code execution, Socra, submission, grading, practice, learner update, analytics aggregation, research export.
Playwright E2E — Student: login, open course, open assignment, edit code, run, ask Socra, receive reply, submit, view learner profile, start practice. Faculty: login, create assignment, generate AI scaffold, edit, preview, publish, inspect submissions, view analytics, view question drilldown. Review: close assignment, login as student, open assignment, verify review mode, request full explanation. Privacy: faculty direct access to student raw transcript endpoint must fail unless explicitly authorized privileged role.
Must pass: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`.

## 33. Documentation

README.md (prereqs, setup, Docker, migrations, seed, dev, build, tests, demo logins, mock AI, real OpenAI, DB reset, troubleshooting); .env.example (every integration var); docs/ARCHITECTURE.md with Mermaid (system architecture, student flow, AI request flow, data pipeline, learning-evidence pipeline, analytics pipeline); docs/ASSUMPTIONS.md; docs/ANALYTICS_DICTIONARY.md; docs/RESEARCH_DATA_DICTIONARY.md; docs/SECURITY.md (auth, sandbox, secrets, privacy, audit); docs/KNOWN_LIMITATIONS.md (factual); docs/BUILD_STATUS.md (maintained continuously).

## 34. CI / DevOps

Docker Compose, Postgres healthcheck, Redis healthcheck, app health endpoint, worker health endpoint, migrations, deterministic seed, reset scripts, production Dockerfile, GitHub Actions CI running lint, typecheck, unit, integration, build. No deploys.

## 36. Autonomous rules

Don't stop for missing credentials — adapter + mock. Don't leave backend unimplemented because UI looks done. No hard-coded analytics numbers. Don't skip tests or migrations. Don't expose secrets. If something is impossible: complete everything around it, create adapter/interface + mock, document exact blocker, continue.

## 37. Final verification

Clean setup via README; app launches; seeded accounts work; student path; faculty path; Socra mock; real OpenAI adapter compiles; code execution; submission; learner profile updates; analytics reflect stored data; research export; raw chats absent from faculty analytics; tests pass; production build succeeds.

## Owner's additional preference

The owner strongly dislikes "AI slop" design/copy. All UI must comply with `docs/DESIGN_GUARDRAILS.md`. A design auditor agent verifies the frontend.
