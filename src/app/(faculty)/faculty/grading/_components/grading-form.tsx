"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, ErrorState, Field, Input, Panel, Textarea } from "@/components/ui";
import { computeRubricPoints, resolveFinalScore } from "@/server/domain/grading/score";
import type { GradingQuestionView } from "@/server/domain/grading/service";

interface QState {
  rubric: Record<string, string>;
  points: string;
  feedback: string;
  overrideReason: string;
  overriding: boolean;
  /** A returned question is read-only until the instructor chooses to regrade it. */
  regrade: boolean;
}

interface Suggestion {
  suggestedPoints?: number;
  maxPoints?: number;
  rationale?: string;
  evidence?: unknown[];
  feedback?: string;
  confidence?: number | string;
}

const isReturned = (q: GradingQuestionView): boolean => q.status === "FINAL" && q.finalScore !== null;

function initialState(questions: GradingQuestionView[]): Record<string, QState> {
  return Object.fromEntries(
    questions.map((q) => {
      const returned = isReturned(q);
      const manual = q.testPoints === null && q.criteria.length === 0;
      const overridden = returned && q.facultyOverride !== null;
      return [
        q.questionId,
        {
          rubric: Object.fromEntries(
            q.criteria.map((c) => [
              c.id,
              q.criterionScores[c.id] !== undefined ? String(q.criterionScores[c.id]) : "",
            ]),
          ),
          // Load the returned score (or the recorded override) so the form never shows an empty value for it.
          points: returned && (manual || overridden) ? String(overridden ? q.facultyOverride : q.finalScore) : "",
          feedback: q.feedback ?? "",
          overrideReason: "",
          overriding: overridden,
          regrade: false,
        } satisfies QState,
      ];
    }),
  );
}

const asSuggestion = (v: unknown): Suggestion | null =>
  v && typeof v === "object" ? (v as Suggestion) : null;

export function GradingForm({
  submissionId,
  questions,
  alreadyFinal,
  canFinalize,
  overallFeedback,
}: {
  submissionId: string;
  questions: GradingQuestionView[];
  alreadyFinal: boolean;
  canFinalize: boolean;
  overallFeedback: string;
}) {
  const router = useRouter();
  const [initial] = useState(() => initialState(questions));
  const [state, setState] = useState<Record<string, QState>>(initial);
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion | null>>(() =>
    Object.fromEntries(questions.map((q) => [q.questionId, asSuggestion(q.aiSuggestion)])),
  );
  const [overall, setOverall] = useState(overallFeedback);
  const dirty = overall !== overallFeedback || questions.some((q) => JSON.stringify(state[q.questionId]) !== JSON.stringify(initial[q.questionId]));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const set = (id: string, p: Partial<QState>) =>
    setState((s) => ({ ...s, [id]: { ...s[id]!, ...p } }));

  async function post(url: string, body: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const b = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
      error?: { message?: string };
    };
    if (!res.ok) throw new Error(b.error?.message ?? "The request failed");
    return b;
  }

  async function suggest(q: GradingQuestionView) {
    setBusy(`ai-${q.questionId}`);
    setError(null);
    try {
      const b = (await post(`/api/grading/submissions/${submissionId}/ai-suggestion`, {
        questionId: q.questionId,
      })) as {
        ok?: boolean;
        message?: string;
        suggestion?: Suggestion;
      };
      if (!b.ok || !b.suggestion)
        throw new Error(
          b.message ?? "No suggestion was produced. You can score this answer yourself.",
        );
      setSuggestions((s) => ({ ...s, [q.questionId]: b.suggestion! }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function retry() {
    setBusy("retry");
    setError(null);
    try {
      await post(`/api/grading/submissions/${submissionId}/retry`, {});
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function computed(q: GradingQuestionView): { computed: number; basis: boolean } {
    const st = state[q.questionId]!;
    const basis = q.testPoints !== null || q.criteria.length > 0;
    if (!basis) {
      // Manual question: an empty field is "not scored", never silently 0.
      return { computed: st.points === "" ? (q.finalScore ?? 0) : Number(st.points), basis };
    }
    const scores = Object.fromEntries(
      Object.entries(st.rubric)
        .filter(([, v]) => v !== "")
        .map(([k, v]) => [k, Number(v)]),
    );
    const rub = q.criteria.length ? computeRubricPoints(q.criteria, scores) : 0;
    return {
      computed: resolveFinalScore({
        maxPoints: q.points,
        testPoints: q.testPoints ?? 0,
        rubricPoints: rub,
      }).computed,
      basis,
    };
  }

  async function finalize() {
    setBusy("finalize");
    setError(null);
    setNotice(null);
    try {
      const payload = {
        feedback: overall || undefined,
        questions: questions.map((q) => {
          const st = state[q.questionId]!;
          const { basis } = computed(q);
          const locked = isReturned(q) && !st.regrade;
          const scores = Object.fromEntries(
            Object.entries(st.rubric)
              .filter(([, v]) => v !== "")
              .map(([k, v]) => [k, Number(v)]),
          );
          return {
            questionId: q.questionId,
            rubricScores: q.criteria.length && !locked ? scores : undefined,
            points: locked
              ? undefined
              : basis
              ? st.overriding && st.points !== ""
                ? Number(st.points)
                : undefined
              : st.points === ""
                ? undefined
                : Number(st.points),
            feedback: st.feedback || undefined,
            overrideReason:
              !locked && (st.overriding || alreadyFinal) ? st.overrideReason || undefined : undefined,
          };
        }),
      };
      await post(`/api/grading/submissions/${submissionId}/finalize`, payload);
      setNotice("Grade finalized and returned to the student.");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {questions.map((q, qi) => {
        const st = state[q.questionId]!;
        const sug = suggestions[q.questionId];
        const c = computed(q);
        const hasTests = q.tests.length > 0;
        const manualOnly = !c.basis;
        const returned = isReturned(q);
        const locked = returned && !st.regrade;
        return (
          <Panel
            key={q.questionId}
            titleAs="h2"
            title={`${qi + 1}. ${q.title}`}
            meta={`${q.points} points`}
            actions={
              <Badge
                tone={
                  q.status === "FINAL" ? "success" : q.status === "PENDING" ? "warning" : "accent"
                }
              >
                {q.status === "FINAL"
                  ? "Graded"
                  : q.status === "PENDING"
                    ? "Waiting for runner"
                    : "Needs review"}
              </Badge>
            }
          >
            <div className="space-y-4">
              <div>
                <h3 className="text-fg text-sm font-medium">
                  {q.type === "CODING"
                    ? `Submitted code${q.language ? ` (${q.language.toLowerCase()})` : ""}`
                    : "Submitted answer"}
                </h3>
                <pre
                  className="border-border bg-surface-2 mt-1 max-h-96 overflow-auto rounded-md border p-3 font-mono text-[13px] leading-5 whitespace-pre-wrap"
                  data-testid="submission-code"
                >
                  {q.answer || "(empty)"}
                </pre>
              </div>

              {q.pendingRunner ? (
                <ErrorState
                  title="Tests have not run yet"
                  action={
                    <Button
                      size="sm"
                      loading={busy === "retry"}
                      loadingLabel="Retrying"
                      onClick={() => void retry()}
                      data-testid="retry-grading"
                    >
                      Retry grading
                    </Button>
                  }
                >
                  The code runner was unavailable, so no score has been recorded. The submission is
                  saved. {q.pendingReason ? `Detail: ${q.pendingReason}` : ""}
                </ErrorState>
              ) : null}

              {hasTests ? (
                <div>
                  <div className="flex items-end justify-between">
                    <h3 className="text-fg text-sm font-medium">Test results</h3>
                    <p className="text-fg-subtle text-xs tabular-nums">
                      {q.tests.filter((t) => t.passed).length} of {q.tests.length} passed ·{" "}
                      {q.testPoints === null
                        ? "Test points not recorded"
                        : `${q.testPoints} of ${q.testPointsMax ?? q.points} test points`}
                    </p>
                  </div>
                  <ul
                    className="divide-border border-border mt-1 divide-y rounded-md border text-sm"
                    data-testid="grading-tests"
                  >
                    {q.tests.map((t, ti) => (
                      <li
                        key={`${q.questionId}:${t.testId}:${ti}`}
                        className="flex items-center justify-between gap-3 px-3 py-1.5"
                      >
                        <span className="min-w-0">
                          <span className="font-medium">{t.passed ? "Passed" : "Failed"}</span> ·{" "}
                          {t.name}
                          {t.message && !t.passed ? (
                            <span className="text-fg-subtle block text-xs">{t.message}</span>
                          ) : null}
                        </span>
                        <span className="text-fg-muted flex shrink-0 items-center gap-2 text-xs">
                          <span className="tabular-nums">weight {t.weight}</span>
                          <Badge tone="neutral">
                            {t.visibility === "HIDDEN" ? (
                              <span className="inline-flex items-center gap-1">
                                <Lock aria-hidden="true" size={12} strokeWidth={1.75} />
                                Hidden
                              </span>
                            ) : null}
                            {t.visibility === "HIDDEN"
                              ? ""
                              : t.visibility === "PUBLIC"
                                ? "Public"
                                : "Diagnostic"}
                          </Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {q.criteria.length > 0 ? (
                <fieldset className="space-y-2">
                  <legend className="text-fg text-sm font-medium">Rubric</legend>
                  {q.criteria.map((cr) => (
                    <div key={cr.id} className="grid items-start gap-3 sm:grid-cols-[1fr_110px]">
                      <div>
                        <p className="text-fg text-sm">{cr.title}</p>
                        {cr.description ? (
                          <p className="text-fg-subtle text-xs">{cr.description}</p>
                        ) : null}
                      </div>
                      <Field
                        id={`rub-${q.questionId}-${cr.id}`}
                        label={`Points (max ${cr.maxPoints})`}
                      >
                        <Input
                          type="number"
                          min={0}
                          max={cr.maxPoints}
                          step="0.5"
                          disabled={locked}
                          value={st.rubric[cr.id] ?? ""}
                          onChange={(e) =>
                            set(q.questionId, { rubric: { ...st.rubric, [cr.id]: e.target.value } })
                          }
                        />
                      </Field>
                    </div>
                  ))}
                </fieldset>
              ) : null}

              {q.aiAvailable || sug ? (
                <div
                  className="border-border bg-surface-2 space-y-2 rounded-md border p-3"
                  data-testid="ai-suggestion"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-fg text-sm font-medium">AI suggestion</h3>
                    {q.aiAvailable ? (
                      <Button
                        size="sm"
                        loading={busy === `ai-${q.questionId}`}
                        loadingLabel="Asking"
                        onClick={() => void suggest(q)}
                        data-testid="grading-ai-suggest"
                      >
                        {sug ? "Get a new suggestion" : "Get AI suggestion"}
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-fg-subtle text-xs">
                    A suggestion only. It does not count until you enter a score and finalize.
                  </p>
                  {sug ? (
                    <div className="space-y-2 text-sm">
                      <p className="text-fg">
                        Suggested score{" "}
                        <span className="font-semibold tabular-nums">
                          {sug.suggestedPoints} / {sug.maxPoints ?? q.points}
                        </span>
                        {sug.confidence !== undefined ? (
                          <span className="text-fg-muted">
                            {" "}
                            · confidence {String(sug.confidence)}
                          </span>
                        ) : null}
                      </p>
                      {sug.rationale ? <p className="text-fg-muted">{sug.rationale}</p> : null}
                      {Array.isArray(sug.evidence) && sug.evidence.length > 0 ? (
                        <ul className="text-fg-muted list-disc pl-5">
                          {sug.evidence.map((e, i) => (
                            <li key={i}>{typeof e === "string" ? e : JSON.stringify(e)}</li>
                          ))}
                        </ul>
                      ) : null}
                      {sug.feedback ? (
                        <p className="text-fg whitespace-pre-wrap">{sug.feedback}</p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() =>
                            set(q.questionId, {
                              points: String(sug.suggestedPoints ?? ""),
                              feedback: st.feedback || sug.feedback || "",
                              overriding: !manualOnly,
                            })
                          }
                          data-testid="ai-approve"
                        >
                          Approve suggestion
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            set(q.questionId, {
                              points: String(sug.suggestedPoints ?? ""),
                              feedback: sug.feedback ?? st.feedback,
                              overriding: !manualOnly,
                            })
                          }
                        >
                          Edit before using
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => set(q.questionId, { points: "", overriding: !manualOnly })}
                        >
                          Ignore and score myself
                        </Button>
                      </div>
                      <p className="text-fg-subtle text-xs">
                        Approve and Edit copy the score and feedback into the fields below. Nothing
                        is saved until you finalize.
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                {locked ? (
                  <div>
                    <p className="text-fg text-sm font-medium">Returned score</p>
                    <p
                      className="mt-1 text-lg font-semibold tabular-nums"
                      data-testid={`returned-${qi}`}
                    >
                      {q.finalScore}{" "}
                      <span className="text-fg-muted text-sm font-normal">/ {q.points}</span>
                    </p>
                    <Button
                      size="sm"
                      className="mt-2"
                      onClick={() => set(q.questionId, { regrade: true })}
                      data-testid={`regrade-${qi}`}
                    >
                      Regrade this question
                    </Button>
                  </div>
                ) : manualOnly ? (
                  <Field
                    id={`pts-${q.questionId}`}
                    label={`Final points (max ${q.points})`}
                    required
                  >
                    <Input
                      type="number"
                      min={0}
                      max={q.points}
                      step="0.5"
                      value={st.points}
                      onChange={(e) => set(q.questionId, { points: e.target.value })}
                      data-testid={`points-${qi}`}
                    />
                  </Field>
                ) : (
                  <div>
                    <p className="text-fg text-sm font-medium">Computed score</p>
                    <p
                      className="mt-1 text-lg font-semibold tabular-nums"
                      data-testid={`computed-${qi}`}
                    >
                      {c.computed}{" "}
                      <span className="text-fg-muted text-sm font-normal">/ {q.points}</span>
                    </p>
                  </div>
                )}
                <Field id={`fb-${q.questionId}`} label="Feedback to the student">
                  <Textarea
                    value={st.feedback}
                    onChange={(e) => set(q.questionId, { feedback: e.target.value })}
                  />
                </Field>
              </div>

              {!manualOnly && !locked ? (
                <div className="space-y-2">
                  <label className="text-fg flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="accent-accent size-4"
                      checked={st.overriding}
                      onChange={(e) => set(q.questionId, { overriding: e.target.checked })}
                    />
                    Override the computed score
                  </label>
                  {st.overriding ? (
                    <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                      <Field id={`ov-${q.questionId}`} label={`Override points (max ${q.points})`}>
                        <Input
                          type="number"
                          min={0}
                          max={q.points}
                          step="0.5"
                          value={st.points}
                          onChange={(e) => set(q.questionId, { points: e.target.value })}
                          data-testid={`override-${qi}`}
                        />
                      </Field>
                      <Field
                        id={`ovr-${q.questionId}`}
                        label="Reason"
                        help="Recorded in the grade history and the audit log."
                        required
                      >
                        <Input
                          value={st.overrideReason}
                          onChange={(e) => set(q.questionId, { overrideReason: e.target.value })}
                          data-testid={`override-reason-${qi}`}
                        />
                      </Field>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Panel>
        );
      })}

      <Panel title="Overall feedback" titleAs="h2">
        <Field id="overall-fb" label="Comment for the student" help="Optional.">
          <Textarea value={overall} onChange={(e) => setOverall(e.target.value)} />
        </Field>
      </Panel>

      {error ? <ErrorState title="Could not complete that">{error}</ErrorState> : null}
      {notice ? (
        <p role="status" className="text-success text-sm">
          {notice}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          disabled={!canFinalize || (alreadyFinal && !dirty)}
          loading={busy === "finalize"}
          loadingLabel="Finalizing"
          onClick={() => void finalize()}
          data-testid="finalize-grade"
        >
          {alreadyFinal ? "Update and return grade" : "Finalize and return grade"}
        </Button>
        <p className="text-fg-muted text-sm">
          {canFinalize
            ? alreadyFinal && !dirty
              ? "Change a score or comment to update the returned grade."
              : "Finalizing releases the score and feedback to the student."
            : "Retry grading first. Some tests have not run."}
        </p>
      </div>
    </div>
  );
}
