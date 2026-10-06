# Analytics dictionary

Faculty analytics are computed deterministically by `recomputeAggregates(courseId?)`
(`src/server/domain/analytics/aggregate.ts`; pure formulas in `metrics.ts`, unit-tested in
`tests/unit/analytics-metrics.test.ts`). The worker runs it every 5 minutes (queue `aggregation`), on demand via
`POST /api/analytics/courses/:courseId/recompute`, and on first view of a course. Pages read only the `*Aggregate`
tables.

## Rules that apply to every metric

- **Value shape**: `{ numerator, denominator, value, suppressed }`. `value = numerator / denominator`.
- **Small-n suppression**: when `denominator < ANALYTICS_SMALL_N_THRESHOLD` (default 5) the value is `null`,
  `suppressed = true`, and the UI shows "Insufficient data (n = d)". Suppression is re-applied at read time with the
  current threshold.
- **Population**: students with an ACTIVE `STUDENT` membership in the course. Staff activity is excluded.
- **Assignments in scope**: state `PUBLISHED_PROTECTED` or `CLOSED`.
- **Correct**: an attempt is correct only with full credit on the question (score fraction ≥ 0.999).
- **Graded attempt**: a submission answer with an authoritative grade: `Grade.status = FINAL`
  (finalScore → facultyOverride → rawPoints), or deterministic tests graded by the system. AI grading suggestions are
  never used. Question-scope grades are used; a submission-scope grade is used only for single-question submissions.
- **Socra use on a question**: an `AiSession` for the student on that question, or on its assignment when the
  session has no question (attributed to every question of the assignment). Intervention levels come from
  `AiMessage.interventionLevel` (assistant turns) and `AiSession.maxInterventionLevel`. **`AiMessage.content` is
  never selected.**
- **Time**: aggregates are all-time (`windowKey = "all"`) unless noted; weekly rows use ISO weeks starting Monday,
  UTC. Rows record `timezone` (course timezone) and `computedAt`.
- **Versioning**: `metricVersion = 1`. A definition change gets a new version.
- **Grain**: course and assignment correctness metrics pool student-question pairs ("tasks"); question metrics are
  per student.
- **Final vs first**: both use graded attempts in `attemptNumber` order, so final correctness equals first-attempt correctness unless students resubmitted with a different outcome. "Revised" in guided recovery includes draft edits after Socra before the first submission, so it does not imply a resubmission.
- **Wording**: the UI reports observed differences only (PRD §25.3, Appendix E). No causal claims.

## Metrics

| Metric (key) | Numerator | Denominator | Sources | Scopes |
| --- | --- | --- | --- | --- |
| First-attempt correctness (`first_attempt_correctness`) | Student-question pairs whose first graded attempt is correct | Pairs with at least one graded attempt | Submission, SubmissionAnswer, Grade | course, assignment, question, topic |
| Final correctness (`final_correctness`) | Pairs whose latest graded attempt is correct | Pairs with at least one graded attempt (students who submitted and were graded) | Submission, SubmissionAnswer, Grade | course, assignment, question, topic |
| Guided recovery (`guided_recovery`) | Revised Socra users whose latest graded attempt after first Socra use is correct | Pairs where the student used Socra and then revised: a graded attempt after first Socra use, and either a `draft_saved`/`answer_changed` event after first Socra use or a different answer hash than the previous attempt | Submission, Grade, AiSession, AnalyticsEvent | course, assignment, question |
| Retry improvement (`retry_improvement`) | Pairs whose latest graded attempt scored higher than the first | Pairs with 2 or more graded attempts | Submission, Grade | course, assignment, question |
| Intervention depth (`intervention_depth`) | Sum of per-task maximum intervention level (0–6) | Tasks (student-question pairs) with Socra use; `max` = highest level | AiSession, AiMessage.interventionLevel | course, assignment, question, topic |
| Completion (`completion`) | Assignment: students with ≥ 1 submission. Course: sum over assignments of submitting students. Question: students who submitted an answer to the question | Assignment/question: enrolled students. Course: enrolled students × assignments in scope | Submission, CourseMembership | course, assignment, question |
| Completion count (`completion_count`) | Students who submitted the question | (count, no denominator) | SubmissionAnswer | question |
| Retry count (`retry_count`) | Students with 2+ graded attempts on the question | (count) | Submission, Grade | question |
| Active students (`active_students`) | Students with any event, submission or Socra session in the last 14 days | Enrolled students | AnalyticsEvent, Submission, AiSession | course |
| Socra usage (`socra_usage`) | Students with at least one Socra session (any mode) | Enrolled students | AiSession | course |
| Weekly Socra users (`socra_weekly_users`, `windowKey` = ISO week) | Students who started a Socra session that week (`metric.sessions` = session count) | Students active in the course that week (any event or Socra session) | AiSession, AnalyticsEvent | course, last 8 weeks |
| Topic difficulty (`difficulty`) — "showing difficulty" | Students whose per-topic difficulty ≥ 0.5, where difficulty = Σ s·(1 − value·independence) / Σ s over their scoring evidence (s, independence as in `docs/LEARNER_MODEL.md`) | Students with graded or practice evidence on the topic | LearningEvidence | topic |
| Unresolved concept (`unresolved`) | Students whose current topic state is Needs reinforcement | Students with a topic state. A topic is listed as unresolved when not suppressed and the share ≥ 0.25 | LearnerTopicState | topic |
| Topic state distribution (`state_needs_reinforcement`, `state_developing`, `state_consistently_demonstrated`) | Students in that state | Students with a topic state | LearnerTopicState | topic |
| Misconception prevalence (`prevalence`) | Unique students with an observation of the misconception, detector confidence ≥ 0.6 | Course scope: students with graded or practice evidence on the misconception's topic, plus observed students. Question scope (`segment = question:<id>`): students who submitted the question, plus observed students | MisconceptionObservation, Misconception, LearningEvidence | course, question |
| Interaction funnel (`funnel`) | Distinct students per step: opened (`question_viewed`, else `assignment_opened`) → attempted (`draft_saved`, `answer_changed`, `code_run_requested`, `submission_completed`, or a submission) → asked Socra (`socra_session_started`/`socra_prompt_sent`) → revised (a work event after first Socra event) → correct after revision (latest graded attempt after first Socra event is correct). Each step is restricted to students in the previous step | (counts; the UI shows each step "of N who opened") | AnalyticsEvent, Submission, Grade | assignment, question |
| Recommendation (`recommendation`) | Highest non-suppressed topic difficulty with its most prevalent reviewed misconception, as advisory text with its basis | — | Aggregates above | course |

## Misconception labels

Only canonical labels (`Misconception.reviewStatus = APPROVED`) appear. Labels proposed by detectors that do not match
an existing key or label are stored as candidates (`source = AI_PROPOSED`, `reviewStatus = PENDING`) and are excluded
from aggregates and learner evidence until faculty approve them. Aggregates record `confidenceThreshold = 0.6` and the
detector versions included (`detectorVersions`).

## Privacy

Aggregates contain no student identifiers. Faculty views read aggregates only and show an anonymous-scope line.
Every analytics read emits `analytics_viewed`. Raw conversations are never part of any metric.
