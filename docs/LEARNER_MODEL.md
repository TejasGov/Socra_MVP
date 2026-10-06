# Learner model V1 (`ltm-v1`)

Code: `src/server/domain/learner/topic-state.ts` (pure, unit-tested in `tests/unit/learner-model.test.ts`).
Every `LearnerTopicState` row records `algorithmVersion = "ltm-v1"` and `computedAsOf`.

The model estimates, per student and topic, which of three qualitative states the current evidence supports:
**Needs reinforcement**, **Developing**, **Consistently demonstrated**. It is not a mastery claim, and the internal
score is never shown to students as a percentage (PRD §12.5).

## Inputs

Append-only `LearningEvidence` rows for the student and course where `invalidatedAt IS NULL` and
`occurredAt <= asOf` (as-of rule: no future evidence). Rows are written by the event consumers in
`src/server/domain/learner/ingest.ts`:

| Evidence type               | Written when                                                            | Scoring? |
| --------------------------- | ----------------------------------------------------------------------- | -------- |
| `FIRST_ATTEMPT_CORRECTNESS` | First graded attempt on a question (value = score fraction)            | yes      |
| `FINAL_CORRECTNESS`         | A later graded attempt (value = score fraction)                         | yes      |
| `RETRY_IMPROVEMENT`         | Later attempt after an imperfect one; value = normalized gain           | yes      |
| `PRACTICE_SUCCESS`          | Practice answer (1 correct / 0 incorrect, or partial score)             | yes      |
| `TRANSFER`                  | Reserved for delayed/linked items                                       | yes      |
| `RECOVERY_AFTER_GUIDANCE`   | Later attempt with Socra help since the previous attempt                | no       |
| `SOCRA_USAGE`               | One row per Socra session and topic                                     | no       |
| `INTERVENTION_DEPTH`        | One row per assistant turn (value = level / 6)                          | no       |
| `MISCONCEPTION_OBSERVED`    | Approved (canonical) misconception observation; feeds common difficulty | no       |

Grades count only when authoritative: `status = FINAL`, or deterministic tests graded by the system. AI grading
suggestions never produce evidence. A regrade with a different score invalidates the earlier row (reason
`superseded_by_regrade`) and appends a new one.

## Weight of one observation

```
w = recency × independence × source

recency      = 0.5 ^ (ageDays / 21)                     (21-day half-life)
independence = 1.0   no help (max intervention level 0)
               0.85  max level L1–L2 (or "assisted" without a recorded level)
               0.6   max level L3–L4
               0.4   max level L5
               0.25  max level L6 (escalation)
source       = 1.0   assessment first attempt (and TRANSFER)
               0.7   assessment final/later attempt
               0.6   practice
               0.5   retry improvement
```

The max intervention level is the highest level of Socra assistant turns on that question (or on the assignment when
the session has no question) before the submission time, read from `AiMessage.interventionLevel` / `AiSession`
metadata. Message content is never read. Practice: explanation requested = L5, `k` hints = L(1+k) capped at 5.

`LearningEvidence.weight` stores `independence × source` (the time-independent part) for transparency.

## Score and state

```
score             = Σ w·value / Σ w        (0 when Σ w = 0)
effectiveEvidence = Σ w
n                 = number of scoring observations

CONSISTENTLY_DEMONSTRATED  if score ≥ 0.8 AND n ≥ 4 AND effectiveEvidence ≥ 2.0
NEEDS_REINFORCEMENT        if score < 0.5 AND n ≥ 2
DEVELOPING                 otherwise
```

The effective-evidence floor means that heavily assisted or old successes alone cannot reach Consistently
demonstrated, and one bad result cannot produce Needs reinforcement.

## Other fields

- **Confidence**: LOW if effectiveEvidence < 1.0, MEDIUM if < 2.5, HIGH otherwise. `confidenceScore = min(1, E / 2.5)`.
- **Trajectory**: compare the (time-independent) weighted mean of scoring observations in the last 14 days with
  the mean before that. Both windows need ≥ 2 observations; a difference ≥ +0.15 is IMPROVING, ≤ −0.15 is
  NEEDS_ATTENTION, otherwise STABLE.
- **lastDemonstratedAt**: latest scoring observation with value ≥ 0.8 and independence ≥ 0.85.
- **commonDifficulty**: the most frequent canonical misconception label on the topic (ties: most recent).
- **assistanceDependency**: share of scoring observations with independence < 1. **firstAttemptRate**: mean of
  first-attempt values.
- **explanation**: plain-language reason shown to the student.

## Rebuild and events

`recomputeTopicStates(userId, courseId)` rebuilds rows from evidence (the computation sorts its input, so results do
not depend on load order). `recomputeAllTopicStates()` rebuilds every pair (use after changing this algorithm or
correcting evidence; the `learner` queue accepts `{ all: true }`). States whose evidence was all invalidated are
deleted. `learner_topic_state_changed` is emitted only when the label changes (including the first computation).

Changing any constant above requires a new version string and a rebuild.
