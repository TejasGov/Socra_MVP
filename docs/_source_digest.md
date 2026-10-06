# Source Digest: Socra data pipelines + AI strategy PDFs

Sources (both dated 2026-10-06):

- `socra_data_pipelines.pdf` = "Data Architecture, Learning Intelligence & Model Improvement Pipelines" (DP below)
- `socra_ai_strategy.pdf` = "Project Vision, AI Architecture & Cost Strategy" (AI below)

Extraction note: both were read via `pdftotext -layout`. Multi-column tables came out interleaved. Where I re-aligned a table
I say so. Items marked [AMBIGUOUS] could not be resolved from the extracted text, so check the PDF page.
Pilot scope for both: CSE 115 / CSE 116 at UB (University at Buffalo), expandable to a multi-course AI-native LMS.

---

# PART 1: DP (socra_data_pipelines.pdf)

---

## 1.1 Core thesis and four data planes

Raw events, inferred learning states, faculty aggregates, research datasets, and model-training data are SEPARATE products of
the pipeline with explicit transformations and permissions between them.

Four planes:

1. Transactional truth: users, courses, assignment versions, submissions, grades, code runs, AI sessions (authoritative).
2. Learning evidence: normalized, versioned observations ("what happened, which concept it may be evidence about"), never
   a claim of permanent ability.
3. Analytics and research: privacy-controlled aggregates, pseudonymous datasets, metric tables, reproducible feature snapshots.
4. Model improvement: curated dataset created ONLY after purpose, consent/protocol, de-identification, quality, and
   train/eval leakage gates.

Hard rule: model-generated labels are NEVER source-of-truth records. A misconception detector emits an _observation_ with
confidence + model version; it does not rewrite history or permanently label the student.

## 1.2 Design principles (names as in doc)

- Event first, state second: store the evidence that caused a learner-state update; current state is a derived view,
  recomputable when models/policies change.
- Purpose limitation: every field/dataset declares a use. Allowed purposes: product operation, student personalization,
  faculty instruction, research, security, model improvement.
- Provenance everywhere: derived records carry source event IDs, assignment/question versions, prompt/model versions,
  feature code version, timestamps.
- Separate identity from research: internal user IDs operationally; pseudonymous participant IDs in research datasets.
- Aggregate before faculty display: class/question/topic aggregates first. Raw Socra transcripts are NOT ordinary analytics data.
- No single opaque learner embedding as truth: use interpretable per-topic features + evidence; vectors only supplement
  retrieval/similarity.
- Training data is opt-in by pipeline, not by accident: production logs never become fine-tuning examples merely because they exist.
- Version the semantics: metric definition, misconception taxonomy, learner-state estimator, prompt all versioned.
- Minimize irreversible inference: do not store sensitive/high-impact inferred traits unless purpose clearly requires.
- Research reproducibility beats cleverness: simple interpretable model with clean lineage > sophisticated unexplainable one.

## 1.3 Data domains (Section 3 table, re-aligned)

| Domain            | Examples                                                             | Authority / sensitivity          | Primary consumers                     |
| ----------------- | -------------------------------------------------------------------- | -------------------------------- | ------------------------------------- |
| Identity          | name, university email, role, course membership                      | Authoritative; FERPA-linked      | Auth, roster, admin                   |
| Assignment        | prompt, topic tags, rubric, policy, versions                         | Authoritative course record      | Student/faculty/AI context            |
| Student work      | draft, code snapshot, written response, submission                   | Authoritative educational record | Student, grading                      |
| Execution         | run ID, language, compile/runtime status, public test results        | Operational + learning evidence  | Student, Socra, analytics             |
| AI interaction    | message, response, model, prompt version, tokens, intervention level | Sensitive conversational data    | Student history, research if approved |
| Learning evidence | correctness, attempt, hint depth, misconception observation          | Derived, auditable               | Learner model, analytics              |
| Learner state     | topic proficiency state, confidence, trend, recency                  | Derived estimate                 | Student, practice engine              |
| Faculty aggregate | topic difficulty, first-attempt correctness, recovery rate           | Derived aggregate                | Faculty                               |
| Research          | pseudonymous events, outcomes, condition                             | Controlled derived dataset       | Research team                         |
| Training/eval     | curated ideal responses, preference labels, adversarial prompts      | Separate governed dataset        | Model improvement team                |

## 1.4 Event collection pipeline

Transactional records and event telemetry are related but NOT interchangeable (submission table = current/final artifact;
event stream = sequence of learning actions).

### Event envelope (exact fields)

```
event_id: UUID
event_name: socra.response_completed        (example)
event_time: UTC timestamp
schema_version: 1
actor_id: internal user UUID
research_participant_id: nullable pseudonymous ID
course_id / section_id
assignment_id / assignment_version
question_id / question_version
session_id
study_condition
app_version
properties: typed event-specific payload
source_trace_id
privacy_classification
```

### Collection mechanics

- Write the authoritative transaction first or in the SAME DB transaction as an outbox record (transactional outbox).
- Background publisher reads outbox, delivers to event pipeline. Pilot = Postgres outbox + worker. Kafka NOT required.
- Consumers build learning evidence, aggregates, research tables, cost/operational metrics ASYNCHRONOUSLY.
- Events must be idempotent; downstream jobs tolerate replay with no double-counting.

### Event families (collect) vs do-not-collect-by-default

- Assignment: opened, question viewed, draft saved, submitted, closed
- Coding: run requested/completed, compile error, runtime error, public tests
- Socra: session started, prompt sent, response completed, intervention level, retrieval used
- Practice: item shown, answered, explanation requested, completed
- Learning: misconception observed, evidence recorded, topic state changed
- Faculty: assignment published, analytics viewed, grade finalized
- Research: condition assigned, outcome captured, export generated
- DO NOT collect by default: every keystroke; full terminal environment variables; hidden chain-of-thought or provider
  internals; mouse-movement surveillance; unsupported personality/ability labels; irrelevant browsing behavior; direct
  identifiers in analysis tables if not needed.

### Appendix A: event dictionary (re-aligned event -> minimal payload)

| Event                                                                                        | Minimal payload                                                                                 |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `assignment.opened`                                                                          | assignment_id, version, course_id                                                               |
| `question.viewed`                                                                            | question_id, version                                                                            |
| `draft.saved`                                                                                | draft_version, content_hash, byte_count                                                         |
| `code.run_completed`                                                                         | run_id, language, status, duration_ms, public_test_summary                                      |
| `socra.prompt_sent`                                                                          | session_id, mode, message_id, question_id                                                       |
| `socra.response_completed`                                                                   | response_id, model, prompt_version, policy_version, intervention_level, latency_ms, token_usage |
| `socra.resource_retrieved`                                                                   | resource_id, chunk_id, rank, retrieval_model_version                                            |
| `submission.completed`                                                                       | submission_id, attempt_no, snapshot_hash                                                        |
| `grade.finalized`                                                                            | submission_id, score, rubric_version, grader_type                                               |
| `misconception.observed`                                                                     | misconception_id, confidence, detector_version                                                  |
| `learning_evidence.recorded`                                                                 | evidence_id, topic_id, type, value, source IDs                                                  |
| `learner_state.changed`                                                                      | topic_id, previous_state, new_state, estimator_version                                          |
| `practice.item_answered`                                                                     | item_id, correctness, attempts, assistance                                                      |
| `faculty.analytics_viewed`                                                                   | view_type, course/assignment/question scope                                                     |
| `research.export_generated`                                                                  | dataset_id, dataset_version, row_count, checksum                                                |
| Doc recommends: use internal names optimized for dev, but document a future Caliper mapping. |

## 1.5 Learning evidence pipeline

Layer converts events into limited-scope claims ("evidence about recursion base cases", "needed intervention level 4 on a
medium-difficulty item"). It must NOT directly claim mastery/lack of mastery.

### learning_evidence fields (Section 5 table, re-aligned)

- evidence_id: immutable identifier
- user_id: operational student link
- topic_id: concept the evidence bears on
- activity_id / question_id: source context
- evidence_type: correctness, hint, misconception, practice, transfer, etc.
- value: typed value, e.g. `correct=true` or `hint_depth=4`
- weight: policy/model-determined contribution
- confidence: confidence in inferred evidence
- observed_at: when event happened
- source_event_ids: lineage
- detector_version: which classifier/rule produced it
- assignment_version: prevents semantic drift
- study_condition: research reproducibility

### Normalization examples

- Question correct on first attempt -> `correctness=1; assistance_depth=0; context=protected`
- Four Socratic questions before correcting code -> `assistance_depth=4; recovered_after_guidance=1`
- Model detects "all decreasing sequences reach zero" at 0.88 -> `misconception_observation=decreasing_implies_zero; confidence=.88; detector=v3`
- Related practice problem correct 10 days later -> retention/transfer evidence with `recency=10d`
  Keep raw evidence even after state changes; profile must be recomputable from historical evidence (no locked old scores).

## 1.6 Student profile: vector + graph + knowledge tracing

Hybrid, not one technology: (a) interpretable per-topic state vector, (b) graph of educational relationships, (c) semantic
embeddings for similarity/retrieval.

### Per-topic state vector (per student-topic pair; example values from doc)

| Feature                    | Example                      | Meaning                                                                |
| -------------------------- | ---------------------------- | ---------------------------------------------------------------------- |
| proficiency_estimate       | 0.64                         | internal probabilistic/normalized estimate; NOT shown as "64% mastery" |
| evidence_confidence        | 0.81                         | how much / how high-quality evidence exists                            |
| recent_trend               | +0.12                        | direction of recent performance                                        |
| assistance_dependency      | 0.38                         | degree to which success required deep help                             |
| recency_days               | 5                            | time since strong evidence                                             |
| first_attempt_rate         | 0.55                         | unaided-ish first-response performance                                 |
| retention_score            | 0.71                         | performance on delayed/transfer items when available                   |
| misconception_distribution | {base_case: .42, trace: .10} | probabilistic observation summary                                      |
| evidence_count             | 14                           | supports confidence calibration                                        |

### V1 estimator

- Start with interpretable rule-based or logistic evidence model with EXPLICIT, validated weights.
- BKT (Bayesian Knowledge Tracing) and LKT (Logistic Knowledge Tracing) = later baselines to benchmark.
- DKT / transformer KT only when longitudinal sample size justifies. Do NOT choose deep model just because product uses AI.
- Every learner-state snapshot declares `estimator_version`.

### Learning graph

- Relations: questions assess topics; topics have prerequisites; misconceptions attach to topics; resources teach topics;
  assignments contain questions; students accumulate evidence on topics.
- V1: PostgreSQL node/edge tables + recursive queries or materialized views. NO Neo4j/graph DB unless traversal becomes a real
  bottleneck/product requirement.

### Embeddings rules

- Use for: course-resource retrieval, similar-question search, clustering similar student questions, candidate examples.
- Embed course content chunks and question text. Optionally embed de-identified Socra turns for offline theme clustering.
- No student names/university IDs/unnecessary identifiers in embedding text.
- Do NOT infer topic proficiency from cosine similarity between a chat embedding and a topic embedding.
- Version the embedding model; regenerate indexes when model families change materially.

## 1.7 Student-facing data (Section 7)

- Topic state labels: `Needs reinforcement` / `Developing` / `Consistently demonstrated`
- Trajectory labels: `Improving` / `Stable` / `Needs attention` (source: recent evidence window)
- "Why this recommendation": evidence summary, human-level text, e.g. "You needed several hints on base cases in two recent activities"
- Practice suggestion: targeted practice CTA (source: topic + item selector)
- Recent history: resume/review (source: sessions/submissions)
- Post-assessment reflection: what changed and what to revisit (source: closed assignment evidence)
- No false precision (no "83.27% mastery") unless psychometrically defensible and UI explains it. Not a surveillance dashboard
  or permanent ability label.
- No numeric thresholds are given for mapping proficiency_estimate to the three labels. [GAP]

## 1.8 Faculty-facing metrics (Section 8, re-aligned: metric = computation -> question)

- First-attempt correctness = correct first valid response / eligible first responses -> "Was the question initially understood?"
- Final correctness = correct final submissions / submissions -> "Did students eventually solve it?"
- Guided recovery = correct after Socra + revision / Socra users who revised -> "Did guidance coincide with recovery?"
- Mean intervention depth = mean max hint level per task -> "How much support did this concept require?"
- Misconception prevalence = unique students with canonical misconception evidence / eligible students -> "What are they misunderstanding?"
- Retry improvement = later score minus first score -> "Are students learning across attempts?"
- Delayed/transfer performance = performance on later linked items -> "Did understanding persist/generalize?"
- Unresolved concept = difficulty remains above configured threshold with adequate evidence -> "What needs reteaching?"

### Aggregation safeguards

- Define denominators in a data dictionary ("struggled" and eligible population explicit).
- Minimum-n suppression or "insufficient data" for very small groups (n not specified).
- Separate observed change from causal claims ("correctness increased after guidance" != "Socra caused it").
- Do NOT use raw time-on-page as direct measure of effort/learning.
- Show confidence/coverage indicators when analytics depend on model-inferred misconception labels.
- Compute faculty statistics DETERMINISTICALLY; LLMs only summarize computed data. Raw conversations stay out of ordinary faculty analytics.

### Appendix B: metric definition rules

- Every percentage has explicit numerator and denominator.
- Every metric declares per-student / per-question / per-submission attempts.
- Every aggregate declares date/time boundary and timezone.
- Every metric based on model labels declares confidence threshold and detector version.
- Every learner-state snapshot declares estimator version.
- Every research table declares row grain: interaction-level, student-level, question-level, or student-question-level.
- Every causal-looking UI phrase is reviewed for design support of causal inference.
- Metric definition bug => new metric version; never silently rewrite published research outputs.

## 1.9 Research data pipeline (Section 9)

Research datasets come from an explicit, versioned export pipeline, NOT analysts querying production tables.

1. Freeze dataset spec: cohort, date range, assignments, events, outcome variables, exclusions, pseudonymization rules.
2. Map internal user IDs -> research participant IDs in a SEPARATELY PROTECTED mapping table.
3. Join event, submission, AI, learner-evidence tables via stable versioned keys.
4. Immutable dataset snapshots with `dataset_version` + generation code commit/hash.
5. Record model, prompt, policy, assignment, question versions so AI-assisted conditions are reconstructable.
6. Validate row counts and study-condition balance before release to analysis.
7. Audit EVERY research export.

### Leakage rules for predictive learner models

- Generalize to unseen students -> split BY STUDENT (random interaction splits leak identity/history).
- Temporal prediction -> time-aware splits; no future interactions in features for earlier predictions.
- Question generalization -> item-level or course-cohort holdouts as a separate experiment.

### Online/offline feature consistency (Section 16; "as-of" rule)

Every training row has an "as-of" timestamp; features computed only from info available before it.

| Feature                  | Online                                 | Offline training snapshot                     |
| ------------------------ | -------------------------------------- | --------------------------------------------- |
| recent_correct_rate      | last N eligible attempts before now    | same event cutoff before prediction timestamp |
| days_since_success       | current time - last success            | prediction_time - prior last success          |
| hint_depth_mean          | eligible prior sessions only           | same historical window                        |
| topic_prerequisite_state | latest states available before request | as-of join, never future state                |
| question_difficulty      | frozen/versioned estimate              | same version used for training                |

## 1.10 Model training / fine-tuning data pipeline (Section 10)

Production data and training data = separate governance domains. Improvement order: evaluation and prompt/policy engineering
FIRST; fine-tune only for a clear measurable failure mode a curated dataset can address.

### Candidate datasets (re-aligned)

| Dataset                        | Example                                              | Purpose                             | Pilot recommendation                |
| ------------------------------ | ---------------------------------------------------- | ----------------------------------- | ----------------------------------- |
| Expert Socratic demonstrations | student prompt + ideal non-solution-bearing response | SFT for tutoring style/policy       | Strongest first dataset             |
| Leakage preference pairs       | safe response vs answer-leaking response             | preference optimization / evaluator | Build early                         |
| Misconception labels           | de-identified context -> canonical label             | classifier/fine-tuning              | Useful after taxonomy stabilizes    |
| Faculty authoring examples     | brief -> reviewed scaffold/rubric                    | authoring quality                   | Low privacy risk if no student data |
| Synthetic adversarial prompts  | jailbreak/direct-answer attempts                     | policy evaluation/training          | Strong                              |
| Raw student chats              | unaltered conversations                              | potential future corpus             | DO NOT train directly in V1         |

### Curation gates (all required)

1. Purpose gate: exactly which model behavior the example teaches.
2. Authority/protocol gate: project permitted to use data for model development (distinct from operating/studying product).
3. De-identification gate: remove direct identifiers and re-identifying context where possible.
4. Secret/IP gate: remove credentials, private repo material, hidden tests, instructor-only solutions, unlicensed material.
5. Quality gate: expert review of target response/label; model-generated label is NOT automatically gold.
6. Deduplication gate: near-duplicate conversations must not dominate.
7. Split gate: assign train/validation/test BEFORE iterative tuning; protect eval set from contamination.
8. Version gate: manifest includes source, transformations, reviewer, timestamps, code version, exclusions.

### Never train on by default

Names/emails/UB person numbers/direct identifiers; raw grades tied to identity unless necessary; private disclosures unrelated
to learning; full raw transcripts merely because available; hidden tests / instructor solution keys; data from participants
whose approved consent conditions disallow model-improvement use; the final held-out eval set.
Train/val/eval separated by student/source.

## 1.11 Privacy, FERPA, governance (Section 11)

- UB 2026 Access to Student Information policy: educational records include student databases, papers, exams,
  correspondence; grades and courses are non-directory information. Submissions, grades, learner profiles, identifiable AI
  interactions = protected educational info.
- FERPA product rule: legitimate educational purpose + least necessary access. Faculty get what they need to teach; raw
  private AI conversations are NOT the default analytics surface.

### Privacy classes

| Class                  | Examples                           | Controls                                                             |
| ---------------------- | ---------------------------------- | -------------------------------------------------------------------- |
| Identity               | name, email, university identifier | Strict RBAC, separate from research IDs                              |
| Educational record     | submission, grade, learner state   | Course-scoped access, encryption, audit                              |
| Sensitive conversation | Socra messages, code snippets      | Restricted access, retention policy, no faculty transcript dashboard |
| Aggregate              | topic difficulty with sufficient n | Faculty access; suppression rules                                    |
| Research pseudonymous  | participant ID + events/outcomes   | Research role, export audit                                          |
| Model-training curated | de-identified approved examples    | Separate storage/project and dataset manifest                        |

### Provider data boundary

- OpenAI API: inputs/outputs not used for training by default unless org opts in; default abuse-monitoring retention may
  keep prompts/responses up to 30 days (endpoint/account dependent).
- Socra persists minimum app state itself, reviews retention of EVERY API endpoint used, does NOT opt into provider data
  sharing for student data without explicit institutional authorization.

## 1.12 Physical architecture V1 (Section 12, re-aligned store -> contents)

- PostgreSQL primary: users, courses, assignments, versions, submissions, grades, evidence, learner states (transactions, constraints, auditability)
- Postgres outbox / queue: pending event messages/jobs (reliable event handoff)
- Object storage: course files, large submission artifacts, research exports
- Vector index: course chunks, questions, approved semantic artifacts (RAG/similarity)
- Analytics schema / materialized views: question/topic/course aggregates (fast dashboards, stable metric defs)
- Research snapshot area: immutable pseudonymous datasets (reproducibility, access separation)
- Training dataset bucket/project: curated JSONL/preferences/evals ONLY (hard separation from raw production logs)
- Separate data warehouse OPTIONAL; Postgres suffices for CSE 115/116 if schema/indexes are designed properly. Add
  warehouse for cross-course scale, heavy BI, long retention, institutional integrations.

## 1.13 Core schema sketch (exact column lists)

- `learning_evidence`: evidence_id, user_id, topic_id, question_id, type, numeric_value/json_value, confidence, weight, source_event_ids, detector_version, observed_at
- `learner_topic_state`: user_id, topic_id, proficiency_estimate, confidence, trend, assistance_dependency, evidence_count, last_evidence_at, estimator_version
- `ai_request`: request_id, user_id, mode, model, prompt_version, policy_version, input_tokens, cached_tokens, output_tokens, latency_ms, status, trace_id
- `misconception_observation`: observation_id, user_id, topic_id, misconception_id, confidence, source_session_id, model_version, reviewed_status
- `question_aggregate_daily`: course_id, question_id, date, eligible_n, first_attempt_correct_n, final_correct_n, socra_user_n, recovered_n, avg_intervention_depth
- `research_event`: participant_id, event_name, event_time, condition, course_id, assignment_id, question_id, payload_version, approved_payload
- `dataset_manifest`: dataset_id, purpose, query/code_version, source_window, inclusion_rules, exclusion_rules, deidentification_version, generated_at, checksum
  Also implied (not sketched): outbox table, participant-id mapping table (separately protected), topic/prerequisite/edge tables,
  audit log, code_run, ai_session, submission snapshot, grading result.

### Appendix C: dataset manifest template (full field list)

dataset_id; name; purpose; owner; source systems; source date range; eligible cohort; IRB / policy basis; fields included;
fields excluded; de-identification transformations; labeling method; quality-review procedure; deduplication method;
train/validation/test split rule; known limitations; code/query version; model/prompt versions represented; record count;
checksum; created_at; retention / deletion rule.

## 1.14 Data quality and lineage (Section 14)

- Schema validation at ingestion. Event missing assignment_version => FAIL or QUARANTINE, never silently accept.
- Referential constraints for authoritative IDs.
- Monitor event lag, duplicate rate, missing-event rate, aggregate reconciliation vs transactional counts.
- Lineage chain: dashboard metric -> aggregate row -> evidence records -> source events/transactions.
- Backfill jobs versioned + idempotent.

### SLIs / targets

| SLI                             | Target                                                 |
| ------------------------------- | ------------------------------------------------------ |
| Submission/event reconciliation | >=99.9% of submitted snapshots have a submission event |
| AI request accounting           | >=99.9% of completed requests have usage/status row    |
| Event freshness                 | p95 evidence processing lag < 5 min for dashboards     |
| Aggregate freshness             | course dashboards updated within 15 min during pilot   |
| Orphan evidence                 | 0 evidence rows with invalid topic/question FK         |
| Duplicate event processing      | 0 net double-counted aggregates after replay           |
| Research export checksum        | manifest checksum + row count verified before analysis |

## 1.15 Misconception pipeline (Section 15)

- Canonical taxonomy with canonical misconception IDs; faculty/research team defines or approves for initial topics.
- Rules or an LLM proposes observations from code, answer, conversation context.
- Each observation stores `confidence` and `detector_version` (schema also has `reviewed_status`).
- Low-confidence novel patterns -> clustering/review queue, NOT immediately a named faculty metric.
- Faculty dashboard aggregates unique students/evidence using a documented threshold (value not given).
- Human review can promote a recurrent cluster to a canonical misconception for future detection.

## 1.16 Retention, deletion, recomputability (Section 17)

Retention must be set with university/research team BEFORE launch; per data class; no "keep forever". Doc gives questions, not values:

- Raw Socra messages: how long for student history, research, debugging, disputes?
- AI request logs: can content be removed while retaining usage/latency metadata?
- Submissions/grades: university course-records policy.
- Learning evidence: how long for profile/research; can be de-identified?
- Learner state: derived + recomputable; deletion should cascade/recompute.
- Research snapshots: per IRB / study data-management plan.
- Training datasets: separate lifecycle; remove source examples if policy requires and feasible.
- Maintain a lineage map so deletion/de-identification jobs find downstream copies (embeddings, cached features, derived
  profiles), not just dashboard rows. Model weights can't be cleanly un-trained => gate datasets BEFORE training.

## 1.17 Interoperability, security (Sections 18-19)

- 1EdTech Caliper Analytics: design internal vocabulary mappable to Caliper later; document mapping; keep course/topic IDs
  stable for competency-framework mapping; consider LTI / OneRoster / QTI / CASE for future LMS integration.
- Encrypt in transit and at rest (managed controls). Least-privilege service identities (analytics worker has no roster admin).
- Separate production, staging, research-export, training-dataset credentials/projects.
- Audit privileged reads of sensitive conversations and EVERY research/training export.
- NEVER put hidden tests, provider API keys, auth tokens into analytics events. Redact secrets from code/run logs before
  long-term storage.
- Row/course authorization at API layer (never client-side filtering only). Back up authoritative data and TEST restores.

## 1.18 Build plan phases (Section 20) [AMBIGUOUS table layout; best reconstruction]

- P0 pilot foundation: Postgres schemas, outbox, event taxonomy, research IDs, AI usage logging, audit logs. Defer Kafka, graph DB, feature platform.
- P1 learning intelligence: evidence ledger, topic state estimator, misconception taxonomy, practice selector, faculty question/topic aggregates. Defer deep knowledge tracing.
- P2 research maturity: immutable dataset manifests, as-of feature snapshots, evaluation datasets, reproducible notebooks/pipelines. Defer automated institution-wide warehouse.
- P3 model improvement: expert demos, preference labels, de-identification pipeline, fine-tuning/eval manifests. Defer training directly on raw chats.
- P4 scale: warehouse/lakehouse, graph service if needed, online feature store, cross-course learner models. Defer premature complexity.

## 1.19 Concrete architecture decisions (Section 21, verbatim intent)

1. PostgreSQL = system of record and initial analytics/evidence store.
2. Transactional outbox, not Kafka.
3. Immutable `learning_evidence` + separately recomputable `learner_topic_state`.
4. Curriculum as explicit topics/prerequisites/evidence relations; "graph" = relational edges/views.
5. Vectors for retrieval only.
6. Transparent weighted/logistic estimator first; BKT/LKT benchmark later.
7. Faculty stats deterministic; LLM summarizes only.
8. Pseudonymize research datasets; version every export.
9. No raw pilot conversations for fine-tuning by default; first expert-reviewed + synthetic Socratic datasets.
10. Train/validation/eval separated by student/source; protect eval set.
11. Raw conversations out of ordinary faculty analytics.
12. Version: model, prompt, policy, assignment, question, taxonomy, estimator, metric, dataset.

## 1.20 End-to-end example (recursion Q4), as processing order

1. assignment_opened / question_viewed emitted.
2. Run `solve(5)`: code_run record with snapshot hash, runtime status, public output; event links run to question version.
3. Student asks "why does this never stop?": `ai_session` + `ai_request` store model/prompt/policy versions; current code sent to protected Socra.
4. Socra asks student to trace values; response stores `intervention_level=2`; raw transcript stays in conversation domain.
5. Student traces 5,3,1,-1, revises; events record answer/code change + another run.
6. Submission correct: immutable submission snapshot + grading result.
7. Evidence normalizer: correctness, recovery_after_guidance, hint_depth, recursion/base-case evidence.
8. Misconception detector: probabilistic observation (assumes decreasing sequence reaches zero, confidence=.88).
9. Learner state update with current `estimator_version`; old evidence remains.
10. Faculty aggregate update: first-attempt %, guided-recovery %, misconception prevalence, avg intervention depth.
11. Later research snapshot: participant ID, condition, versions, outcomes, approved event features; identity omitted.
12. Training pipeline does NOTHING automatically.

Intervention levels: DP uses `intervention_level` (example 2; evidence example "level 4"; hint_depth up to 4) but DOES NOT define the
level scale or semantics. Definition must come from the PRD / policy doc. [GAP]

---

# PART 2: AI (socra_ai_strategy.pdf)

---

## 2.1 Product idea

- AI-native learning environment for intro university CS. AI behavior changes by educational context:
  - Protected homework/quizzes: AI understands student's code/reasoning but WITHHOLDS solution-bearing assistance.
  - Practice and post-assessment review: AI becomes a much more direct tutor.
- Closed learning loop: faculty creates assignment with learning objectives + course context -> student works in native coding or
  written-response workspace -> Socra automatically sees prompt, current work, errors, output, approved course resources ->
  protected Socra gives diagnostic/Socratic help without completing core assessed task -> structured evidence (attempts,
  hint depth, misconceptions, recovery, correctness, topic associations) -> learner profile updates with topic states
  `Needs reinforcement` / `Developing` / `Consistently demonstrated` -> faculty analytics aggregate class pain points and
  question-level insight -> faculty adapts instruction or creates targeted follow-up practice.
- Differentiators vs LMS/chatbot: understands assignment + live workspace; controls solution-bearing disclosure; assessment +
  practice + learner model + analytics loop; converts interactions to aggregate instructional signals.
- Competitive position (Canvas+OpenAI validates category): focus on protected cognitive assistance, CS-native workspace
  understanding, intervention depth, misconception analytics, privacy-preserving instructional intelligence.

## 2.2 Pilot V1 scope (not a prototype)

Must include: authentication, course/assignment state, coding or written-response workspaces, AI orchestration, secure code
execution, persistence, submission, grading, learner data, analytics, research telemetry, privacy controls, observability,
administration.

## 2.3 Research goal

Test whether constrained Socratic AI improves learning outcomes, reduces direct-answer dependence, preserves cognitive effort,
improves retention, exposes useful class-level misconceptions vs unrestricted AI or conventional support conditions,
subject to approved study design. => at least: constrained-Socratic, unrestricted-AI, conventional-support conditions
(exact condition enum not given in this doc; see PRD).

## 2.4 AI roles (Section 4 table, best-effort alignment; table was garbled) [AMBIGUOUS cells]

Roles: Protected Socratic tutor; Practice tutor; Quiz/question generator; Interactive card generator; Misconception extractor;
Topic/tag classifier; Faculty assignment copilot; Rubric/feedback suggester; Analytics narrative writer; Policy/leakage
checker; Course-material embeddings.

- Protected Socratic tutor: very high volume, very high quality need, high latency need, mixed output -> Balanced tier.
- Practice tutor: high volume, high quality, high latency need -> Economy/Balanced.
- Quiz/question generator, interactive card generator, topic/tag classifier: structured, Economy.
- Misconception extractor: quality need "Very high", structured/mixed -> table says Balanced/Premium. (CONFLICT with routing; see Part 3.)
- Faculty assignment copilot / rubric-feedback suggester: low volume, high quality -> Economy/Balanced (routed to Sol).
- Analytics narrative writer: input is computed metrics -> Economy.
- Policy/leakage checker: Balanced.
- Embeddings: batch, vector, Embedding model.
  Principle: route bounded structured tasks to the CHEAPEST model that passes an internal accuracy threshold.
  Faculty authoring: low-volume, high-value; quality dominates cost. Analytics AI: NEVER invent statistics; counts, %, gains,
  funnels computed deterministically in SQL/analytics jobs; AI gets computed metrics and writes summaries only.

## 2.5 Model stack and routing (exact assignments)

Recommended Pilot V1 stack (OpenAI-only; Anthropic/Google = benchmark/fallback candidates, not simultaneous prod deps in first study):

| Capability                   | Model                          |
| ---------------------------- | ------------------------------ |
| Protected Socratic tutor     | GPT-6.1 Sol                    |
| Cheap structured AI / router | GPT-6 Luna                     |
| Faculty authoring            | GPT-6.1 Sol                    |
| Practice question generation | GPT-6 Luna first; Sol fallback |
| Misconception extraction     | GPT-6 Luna                     |
| Weekly teaching brief        | GPT-6 Luna or Sol              |
| Embeddings / course RAG      | text-embedding-3-small         |

### Routing table (Section 8; default / escalation) [re-aligned best effort]

| Request type                  | Default                       | Escalation                                                              |
| ----------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| Protected Socratic chat       | GPT-6.1 Sol                   | GPT-6 Astra ONLY for internal evals, never arbitrary student escalation |
| Simple practice explanation   | GPT-6 Luna                    | GPT-6.1 Sol                                                             |
| Practice question generation  | GPT-6 Luna                    | GPT-6.1 Sol (can be precomputed/cached)                                 |
| Interactive card JSON         | GPT-6 Luna                    | None normally (bounded structured output)                               |
| Topic classification          | GPT-6 Luna                    | None normally (cheap classification)                                    |
| Misconception extraction      | GPT-6 Luna                    | GPT-6.1 Sol if low confidence                                           |
| Faculty assignment generation | GPT-6.1 Sol                   | GPT-6 Astra for rare high-value benchmark tests (quality first)         |
| Rubric feedback suggestion    | GPT-6.1 Sol                   | Faculty human review (impact on grades)                                 |
| Analytics weekly brief        | GPT-6 Luna                    | GPT-6.1 Sol (input already computed metrics)                            |
| Policy output check           | Rule-based + Sol adjudication | Defense-in-depth; FUTURE work                                           |

### Routing policy (V1, simple)

- Student protected chat ALWAYS uses the study's fixed protected model.
- Faculty high-value authoring -> balanced model. Deterministic classification/extraction/card tasks -> economy model.
- Post-assessment and practice -> economy by default, explicit escalation if eval shows quality threshold missed.
- NO per-turn dynamic difficulty routing in the research study (confound: same-condition students get different capability).
  Dynamic routing = non-core tasks or post-study production phase.
- Fallback must NEVER silently change a study condition. Protected tutor model fixed for a cohort unless protocol permits changes.
- Decision: OpenAI single-provider for V1 (existing API key); Astra/Opus/other frontier models kept out of default student path.

## 2.6 AI gateway architecture (Section 13)

- ONE server-side AI gateway owns provider credentials and model selection. No provider key ever sent to browser.
- Every request includes explicit `mode` enum: `PROTECTED_ASSESSMENT`, `PRACTICE`, `POST_ASSESSMENT_REVIEW`, `FACULTY_AUTHORING`, `FACULTY_ANALYTICS`.
- Gateway attaches: prompt version, assignment policy version, course/assignment identifiers, research condition, trace ID.
- Structured tasks use JSON-schema outputs.
- Usage record per request stores: input tokens, cached tokens, output/reasoning tokens (where exposed), request cost, latency, provider, model, status.
- Implement per-request cost logging AND per-course budgets BEFORE opening pilot to students. Per-course budget alerts (P0).
- Log every model / prompt / policy version.

## 2.7 Evaluation (Phase 0) and decision criteria

- Build 100-300 representative Socra prompts across: coding, conceptual help, jailbreak attempts, syntax errors, runtime
  errors, ambiguous student questions.
- Run GPT-6.1 Sol, Claude Sonnet 5.5, Gemini 3.1 Pro, GPT-6 Luna, optionally Claude Haiku 4.5 (Section 10.1 also says "one economy model").
- Score: answer leakage, usefulness, correctness (coding diagnosis), false refusals, latency, cost. NOT generic benchmarks alone.
- Select protected model BEFORE study cohort begins; keep stable during study.
- Retrieval eval: keep text-embedding-3-small unless retrieval evaluation shows need for stronger.
- Decision matrix: OpenAI-only Luna+Sol = "BEST V1" (cost 4/5, coding 4.5/5); all-Sol = "BEST SIMPLE V1"; Google Flash-Lite+Pro and
  Anthropic Haiku+Sonnet = "Benchmark alternative"; multi-provider live routing = "Do later"; frontier-only = "Overkill for default usage".

## 2.8 Phases (Section 16)

- Phase 0 Evaluation: as above.
- Phase 1 Research pilot: protected tutor stable; one provider where possible; cheap aux model for non-core structured tasks;
  log all versions; optimize context + caching BEFORE model switching.
- Phase 2 Post-research production: model-router quality thresholds; continuous provider benchmarking; confidence-based
  escalation; batch generation for question banks + analytics preprocessing; negotiate enterprise/university pricing.

## 2.9 Metrics to instrument from day one (Section 14)

| Metric                            | Unit                        |
| --------------------------------- | --------------------------- |
| AI cost / active student          | $/student/week and semester |
| AI cost / assignment              | $/assignment                |
| AI cost / successful intervention | $/recovery                  |
| Input tokens / turn               | tokens                      |
| Output tokens / turn              | tokens                      |
| Cached-token share                | %                           |
| Model escalation rate             | %                           |
| Protected leakage rate            | % of eval cases             |
| False refusal rate                | % of legitimate help cases  |
| AI latency p50/p95                | seconds                     |
| AI failure rate                   | % requests                  |
| Guided recovery rate              | %                           |

## 2.10 Cost optimization levers (priority)

| Lever                                                                                                                            | Priority |
| -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| Prompt/context caching                                                                                                           | P0       |
| Conversation summarization (reduce repeated history)                                                                             | P0       |
| Cheap-model routing                                                                                                              | P0       |
| Pre-generated practice bank (avoid live generation each attempt)                                                                 | P0       |
| Structured outputs                                                                                                               | P0/P1    |
| Output token caps                                                                                                                | P0       |
| Batch generation (~50% discount with some providers)                                                                             | P1       |
| Cached course embeddings (embed once, retrieve many)                                                                             | P0       |
| Model fallback only on failure (avoid premium default)                                                                           | P1       |
| Per-course budget alerts                                                                                                         | P0       |
| (Priority-to-lever mapping from garbled table is best-effort; the first four P0 labels and "budget alerts P0" are solid.)        |
| Caching example: 10,000 stable context tokens + 2,000 changing tokens/turn; Sol uncached input $2/M => ~$0.02/request; cached at |
| assumed $0.10/M => ~$0.001; across 100,000 turns ~ $1,900 saved (before cache-write and provider rules). Implication: keep       |
| assignment/system/course context as a STABLE PREFIX, put changing conversation + code last.                                      |
| Embedding cost: 5M tokens x $0.02/M = ~$0.10. Don't optimize around embedding/classification cost before fixing context bloat    |
| and protected-tutor quality.                                                                                                     |

## 2.11 Pricing (USD per 1M tokens, snapshot 2026-10-06; planning, not quotes)

| Model                                                                                        | In    | Out   | 3K in + 500 out request | Base $/student/semester | Tier (sec 5)                                                   |
| -------------------------------------------------------------------------------------------- | ----- | ----- | ----------------------- | ----------------------- | -------------------------------------------------------------- |
| OpenAI GPT-6 Luna                                                                            | 0.10  | 0.50  | $0.00055                | $0.14                   | Economy (1.05M ctx)                                            |
| Cohere Command R                                                                             | 0.15  | 0.60  | $0.00075                | $0.20                   | Economy (128K ctx)                                             |
| Google Gemini 3.1 Flash-Lite                                                                 | 0.25  | 1.50  | $0.00150                | $0.40                   | Economy (1M ctx, preview)                                      |
| Google Gemini 3 Flash                                                                        | 0.50  | 3.00  | $0.00300                | $0.79                   | Value (1M ctx, preview)                                        |
| Anthropic Claude Haiku 4.5                                                                   | 1.00  | 5.00  | $0.00550                | $1.44                   | Value                                                          |
| OpenAI GPT-6.1 Sol                                                                           | 2.00  | 10.00 | $0.01100                | $2.88                   | Balanced                                                       |
| Anthropic Claude Sonnet 5.5                                                                  | 2.00  | 10.00 | $0.01100                | $2.88                   | Balanced                                                       |
| Google Gemini 3.1 Pro                                                                        | 2.00  | 12.00 | $0.01200                | $3.16                   | Balanced                                                       |
| OpenAI GPT-5.6 Terra                                                                         | 2.00  | 12.00 | $0.01200                | $3.16                   | Balanced                                                       |
| Anthropic Claude Opus 5.5                                                                    | 4.00  | 20.00 | $0.02200                | $5.77                   | Premium (offline eval/authoring benchmark)                     |
| OpenAI GPT-5.6 Sol                                                                           | 4.00  | 20.00 | $0.02200                | $5.77                   | Premium (promo pricing time-limited)                           |
| OpenAI GPT-6 Astra                                                                           | 10.00 | 50.00 | $0.05500                | $14.42                  | Frontier (hard benchmark / rare faculty gen; not default chat) |
| Re-aligned from garbled columns; I verified each by recomputing the formulas, which matched. |

- text-embedding-3-small: $0.02 / 1M tokens.

### Formulas (Appendix A)

```
Request cost  = (input_tokens / 1,000,000 * input_rate) + (output_tokens / 1,000,000 * output_rate)
Base semester cost per student = [(654,000/1M * input_rate) + (120,000/1M * output_rate)] * 1.15
With caching: price uncached and cached input tokens separately.
Reasoning/thinking tokens billed as output: include in output-token quantity.
```

Workload assumptions per student per semester:

- Protected assignment AI: 28 sessions x 6 turns x (~3,000 in + 500 out) = 504K in / 84K out
- Practice AI: 12 sessions x 5 turns x (~2,500 in + 600 out) = 150K in / 36K out
- Subtotal 654K in / 120K out; operational overhead = 15% uplift (retries, guardrails, summaries, variance)
  Usage scenarios (each incl. 15% overhead): Low = 300K in + 50K out; Base = 654K + 120K; High = 1.5M + 300K.

Sensitivity ($/student): Luna 0.06/0.14/0.35; Flash-Lite 0.17/0.40/0.95; Haiku 4.5 0.63/1.44/3.45; Sol 1.26/2.88/6.90;
Sonnet 5.5 1.26/2.88/6.90; Gemini 3.1 Pro 1.38/3.16/7.59; Terra 1.38/3.16/7.59; Opus 5.5 & GPT-5.6 Sol 2.53/5.77/13.80;
Astra 6.32/14.42/34.50; Command R 0.09/0.20/0.47; Gemini 3 Flash 0.35/0.79/1.90.

Cohort model-only cost (base): Luna $7/$14/$36/$72/$144 at 50/100/250/500/1000 students; Flash-Lite $20/$40/$99/$198/$395;
Haiku 4.5 $72/$144/$361/$721/$1,442; Sol & Sonnet 5.5 $144/$288/$721/$1,442/$2,884; Astra $721/$1,442/$3,605/$7,210/$14,421
(Gemini 3 Flash row not extracted cleanly.)
250-student pilot: all-Luna $36 ($10/mo over 3.5 mo); hybrid 65% Luna / 35% Sol = $276 ($79/mo; "recommended after evals");
all-Sol $721 ($206/mo; simplest/consistent research condition). Excludes code-exec infra, DB/hosting, observability, taxes, tool charges.

Function-level cost illustration (250 students, 2 courses):

- Protected tutor on Sol: 126M in / 21M out (+overhead) = ~$531
- Practice (Luna): 37.5M in / 9M out (+overhead) = ~$9
- Faculty authoring (Sol): ~150 generation calls, 1.2M in / 0.4M out = ~$6
- Misconception extraction (Luna): ~50K calls, 25M in / 5M out = ~$5
- Weekly faculty briefs (Luna): 14 weekly briefs x 2 courses, 0.5M in / 0.05M out = ~$0.08
- Course embeddings: 5M source tokens = ~$0.10
  Row-to-cost mapping re-derived by recomputation; it is internally inconsistent in overhead handling (see Part 3).

Planning budget envelopes (lean / comfortable / ceiling): 50 students $50-150 / $200-400 / $500;
100: $100-300 / $300-700 / $1,000; 250: $250-750 / $750-1,500 / $2,500; 500: $500-1,500 / $1,500-3,000 / $5,000.
Larger financial risks = engineering time, secure code execution, reliability, compliance/ops, not text-token spend.

## 2.12 Build vs buy

- Build: assessment lifecycle and policy modes; workspace/code context assembly; secure code execution; learner evidence
  model; misconception taxonomy; faculty analytics; research telemetry/evaluation.
- Buy/use: foundation model inference; embeddings; optional moderation/safety primitives; cloud infra; provider caching
  primitives; managed DB/vector storage (optional); model benchmark capability.
- Moat = educational system around models (protected assessment policy, context-aware intervention, coding-workspace
  integration, longitudinal evidence, misconception analytics, faculty intelligence, research), NOT a specific model.

---

# PART 3: CONFLICTS, GAPS, AND INTEGRATION NOTES

---

## 3.1 Direct conflicts / mismatches between DP and AI

1. `ai_request` schema (DP) is missing fields AI requires in usage records: provider, request cost, output/reasoning tokens
   (only input_tokens/cached_tokens/output_tokens present), research condition, assignment/course identifiers, and
   cost-per-intervention linkage. AI requires gateway to attach condition, course/assignment IDs, trace ID. => Extend
   `ai_request` with: provider, cost_usd, reasoning_tokens, study_condition, course_id, assignment_id, question_id, session_id,
   fallback/escalation flag, routing_reason.
2. `mode` values: AI defines 5 (PROTECTED_ASSESSMENT, PRACTICE, POST_ASSESSMENT_REVIEW, FACULTY_AUTHORING, FACULTY_ANALYTICS).
   DP only has a free-form `mode` in `socra.prompt_sent` / `ai_request` with no enum. Use the AI enum. Note DP's event dictionary
   covers only student-side AI events; there are no events for faculty authoring/analytics AI calls (ai_request alone covers).
3. Misconception extractor tier: AI Section 4 table lists it as very-high quality, "Balanced/Premium"; AI Sections 1/8/18 route it to
   GPT-6 Luna (Sol only on low confidence). DP requires confidence, detector_version, reviewed_status, human review queue and taxonomy.
   Resolution implied: Luna default, escalate to Sol when low confidence; record model in `misconception_observation.model_version`.
   No numeric low-confidence threshold is given in either doc. [GAP]
4. Weekly brief model: AI exec table says "GPT-6 Luna or Sol"; routing table says Luna with Sol escalation; function cost
   table's weekly-brief row prices at Luna rate. Treat Luna default.
5. Practice generation: stack table says Luna first / Sol fallback; routing table says same. Fine. But the role table lists
   Practice tutor as Economy/Balanced; routing default for "simple practice explanation" is Luna. Consistent (Luna default).
6. Tier labels: Haiku 4.5 is "Value" in Section 5 but listed among "Balanced tier" candidates in Section 9.2; Gemini 3 Flash is
   "Value" in 5 but sits in Economy in 9.1. Cosmetic.
7. Cost table arithmetic: Section 11 rows mix overhead usage. Protected ($531) and practice ($9) include 15% overhead;
   authoring ($6) and misconception ($5) appear to be raw token cost. The doc itself says the table "intentionally overstates
   some auxiliary workloads". Don't use as budget source; use Appendix A formula.
8. Event naming style is inconsistent inside DP: dotted names in envelope/Appendix A (`socra.response_completed`,
   `assignment.opened`, `code.run_completed`) vs underscore/prose names in Section 4.3/22 (`assignment_opened`,
   `question_viewed`, `code_run`, "run requested", "compile error", "runtime error"). Section 4.3 lists events (code.run_requested,
   compile/runtime error, session started, item shown, explanation requested, assignment published/closed, condition assigned,
   outcome captured) that are NOT in the Appendix A dictionary. Pick dotted `family.action` and extend the dictionary.
9. DP envelope example uses `socra.` prefix for AI events while research table uses `event_name` generic; no prefix list for
   practice/research (`practice.item_answered`, `research.export_generated` used). OK but not enumerated.
10. Provider boundary: DP says review retention of EVERY API endpoint and not opt in to data sharing; AI says use a single
    OpenAI provider and mentions provider caching/batch (batch/caching endpoints may have different retention). Needs per-endpoint
    retention review before using caching/batch/Responses-type endpoints.
11. Cached/context resend: AI says dominant cost is context resent on every turn; DP says raw transcripts are in a restricted
    conversation domain and do not feed analytics. Conversation summarization (AI P0) creates a NEW derived artifact containing
    student content; DP has no schema or retention class for summaries. [GAP: treat as Sensitive conversation class.]
12. Model identification: DP `misconception_observation.model_version` and `ai_request.model` imply exact model snapshot IDs
    logged; AI uses marketing names (GPT-6.1 Sol, GPT-6 Luna). Log exact provider model ID/snapshot, not alias.
13. DP warns against provider-internals/hidden chain-of-thought collection, while AI wants reasoning-token counts logged.
    Resolution: log reasoning TOKEN COUNTS only, never content.

## 3.2 Gaps neither doc defines (must come from PRD/other)

- Intervention level scale (0..N) and semantics; only `intervention_level` int examples (2, 4) and hint_depth=4 appear.
- Study condition enum values and assignment algorithm (only "condition assigned" event and `study_condition` field).
- Thresholds: proficiency_estimate -> {Needs reinforcement, Developing, Consistently demonstrated}; trend -> {Improving, Stable,
  Needs attention}; minimum-n suppression value; misconception faculty threshold; "difficulty above configured threshold";
  low-confidence escalation threshold; leakage-rate acceptance threshold; "internal accuracy threshold" for economy models.
- Retention durations for every data class (explicitly deferred to university/IRB).
- Evidence weights for the V1 rule/logistic estimator ("explicit and validated" but not specified).
- Budget enforcement behavior at limit (alert only vs. hard stop); per-course budget values beyond envelopes in 2.11.
- Output token caps values; conversation summarization trigger.
- Policy/leakage checker design (rule-based + Sol adjudication) is explicitly FUTURE work, not V1.
- Prompt/policy version storage schema (only `prompt_version` and `policy_version` fields; assignment policy version attached by gateway).

## 3.3 Items both docs agree on (safe to implement)

- Postgres-first; no Kafka; no graph DB; embeddings only for retrieval (text-embedding-3-small).
- Faculty numbers computed deterministically in SQL; LLM only narrates.
- Protected tutor model fixed per study cohort; fallback never silently changes study condition.
- Version everything (model, prompt, policy, assignment, question, detector, estimator, metric, dataset).
- Student topic states: Needs reinforcement / Developing / Consistently demonstrated.
- Raw student chats not used for fine-tuning in V1; evaluation/prompt-policy engineering first; expert demos, leakage preference
  pairs, adversarial prompts are the first training/eval datasets (AI's Phase 0 eval set of 100-300 prompts = DP's
  "synthetic adversarial prompts"/eval dataset; keep it held out).
- Guided recovery is the headline pedagogical metric in both (DP formula: correct after Socra + revision / Socra users who revised;
  AI: "Guided recovery rate %" and "cost per successful intervention $/recovery").
