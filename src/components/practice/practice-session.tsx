"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Button,
  ErrorState,
  LinkButton,
  LoadingState,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
} from "@/components/ui";
import { SocraPanel } from "@/components/socra/socra-panel";
import { apiJson, newIdempotencyKey } from "@/components/workspace/api";
import { CodeEditor } from "@/components/workspace/code-editor";
import { Markdown } from "@/components/workspace/markdown";
import type { WorkspaceLanguage } from "@/components/workspace/types";

/** Mirrors PracticeItemView / AnswerResult / PracticeSummary from src/server/domain/practice. */
export interface PracticeItemDto {
  attemptId: string;
  itemId: string;
  topicId: string;
  topicName: string;
  type: "CODING" | "SHORT_ANSWER" | "MULTIPLE_CHOICE" | "TRACE" | "EXPLAIN";
  difficulty: number;
  prompt: string;
  starterCode: string | null;
  language: string | null;
  choices: Array<{ id: string; text: string }> | null;
  reviewed: boolean;
  scaffold: boolean;
  scaffoldNote: string | null;
  position: number;
}

interface AnswerResultDto {
  attemptId: string;
  correct: boolean | null;
  feedback: string;
  explanation: string | null;
  correctAnswer: string | null;
  selfAssess: boolean;
  nextDifficulty: number;
  scaffoldNext: boolean;
  difficultyChange: "UP" | "DOWN" | "NONE";
}

export interface PracticeSummaryDto {
  sessionId: string;
  status: string;
  itemsServed: number;
  answered: number;
  correctCount: number;
  topics: Array<{ topicId: string; name: string; answered: number; correct: number }>;
  followUps: Array<{ topicId: string; name: string; reason: string }>;
}

type Phase = "loading" | "answering" | "feedback" | "empty" | "finished" | "error";

const TYPE_LABEL: Record<PracticeItemDto["type"], string> = {
  MULTIPLE_CHOICE: "Multiple choice",
  SHORT_ANSWER: "Short answer",
  TRACE: "Predict the output",
  EXPLAIN: "Explain in your own words",
  CODING: "Write code",
};

const LANGS: Record<string, WorkspaceLanguage> = {
  PYTHON: "PYTHON",
  JAVASCRIPT: "JAVASCRIPT",
  SCALA: "SCALA",
};

/** Server feedback often repeats the headline ("Not quite. …"); drop the duplicate opener. */
function feedbackBody(r: AnswerResultDto): string {
  return r.feedback.replace(/^\s*(Correct\.|Not quite\.)\s*/i, "").trim();
}

function difficultyLine(change: AnswerResultDto["difficultyChange"], scaffold: boolean) {
  if (change === "UP") return "Next question is a step harder.";
  if (change === "DOWN")
    return scaffold
      ? "Next question is a step easier and broken into smaller steps."
      : "Next question is a step easier.";
  return "Next question stays at the same difficulty.";
}

export function PracticeSession({
  sessionId,
  courseId,
  courseCode,
  initialSummary,
}: {
  sessionId: string;
  courseId: string;
  courseCode: string;
  /** Present when the session is already completed. */
  initialSummary: PracticeSummaryDto | null;
}) {
  const [phase, setPhase] = useState<Phase>(initialSummary ? "finished" : "loading");
  const [item, setItem] = useState<PracticeItemDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<AnswerResultDto | null>(null);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PracticeSummaryDto | null>(initialSummary);
  const [answeredCount, setAnsweredCount] = useState(0);
  const idem = useRef<string | null>(null);
  const answerRef = useRef(answer);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const answerId = useId();
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    answerRef.current = answer;
  }, [answer]);

  const loadNext = useCallback(async () => {
    const res = await apiJson<{ item: PracticeItemDto | null; message: string | null }>(
      `/api/practice/sessions/${encodeURIComponent(sessionId)}/next`,
      { method: "POST" },
    );
    if (!res.ok) {
      setError(
        res.status === 0
          ? "Couldn't reach the server. Your earlier answers are saved."
          : `${res.error.message} Your earlier answers are saved.`,
      );
      setPhase("error");
      return;
    }
    if (!res.data.item) {
      setItem(null);
      setMessage(res.data.message ?? "No more questions are available for this topic right now.");
      setPhase("empty");
      return;
    }
    idem.current = null;
    setError(null);
    setResult(null);
    setExplanation(null);
    setItem(res.data.item);
    setAnswer(res.data.item.type === "CODING" ? (res.data.item.starterCode ?? "") : "");
    setPhase("answering");
  }, [sessionId]);

  const goNext = () => {
    setPhase("loading");
    void loadNext();
  };

  useEffect(() => {
    // Fetch the first question on mount; state is only set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!initialSummary) void loadNext();
  }, [initialSummary, loadNext]);

  useEffect(() => {
    if (phase === "answering") headingRef.current?.focus();
    if (phase === "feedback") feedbackRef.current?.focus();
  }, [phase, item?.attemptId]);

  const submit = async () => {
    if (!item || submitting || answer.trim() === "") return;
    setSubmitting(true);
    setError(null);
    if (!idem.current) idem.current = newIdempotencyKey();
    const res = await apiJson<AnswerResultDto>(
      `/api/practice/sessions/${encodeURIComponent(sessionId)}/answer`,
      {
        method: "POST",
        body: {
          itemId: item.itemId,
          attemptId: item.attemptId,
          answer,
          idempotencyKey: idem.current,
        },
      },
    );
    setSubmitting(false);
    if (!res.ok) {
      setError(
        res.status === 0
          ? "Couldn't reach the server, so your answer was not checked. Submit it again."
          : `Couldn't check your answer: ${res.error.message}`,
      );
      return;
    }
    setResult(res.data);
    if (!res.data.selfAssess) setAnsweredCount((n) => n + 1);
    if (res.data.explanation) setExplanation(res.data.explanation);
    setPhase("feedback");
  };

  const selfAssess = async (correct: boolean) => {
    if (!result) return;
    setSubmitting(true);
    const res = await apiJson<AnswerResultDto>(
      `/api/practice/sessions/${encodeURIComponent(sessionId)}/answer`,
      { method: "POST", body: { attemptId: result.attemptId, selfAssessedCorrect: correct } },
    );
    setSubmitting(false);
    if (!res.ok) {
      setError(`Couldn't record your self-check: ${res.error.message}`);
      return;
    }
    setResult(res.data);
    setAnsweredCount((n) => n + 1);
  };

  const explain = async () => {
    if (!item || explaining) return;
    setExplaining(true);
    const res = await apiJson<{ explanation: string; correctAnswer: string | null }>(
      `/api/practice/sessions/${encodeURIComponent(sessionId)}/explain`,
      { method: "POST", body: { itemId: item.itemId } },
    );
    setExplaining(false);
    if (!res.ok) {
      setError(`Couldn't load an explanation: ${res.error.message}. You can ask Socra instead.`);
      return;
    }
    setExplanation(res.data.explanation);
  };

  const finish = async () => {
    setPhase("loading");
    const res = await apiJson<PracticeSummaryDto>(
      `/api/practice/sessions/${encodeURIComponent(sessionId)}/complete`,
      { method: "POST" },
    );
    if (!res.ok) {
      setError(`Couldn't finish the session: ${res.error.message}. Your answers are saved.`);
      setPhase("error");
      return;
    }
    setSummary(res.data);
    setPhase("finished");
  };

  if (phase === "finished" && summary) {
    return <PracticeSummaryView summary={summary} courseId={courseId} courseCode={courseCode} />;
  }

  const lang = item?.language ? (LANGS[item.language] ?? null) : null;
  const locked = phase === "feedback";

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="min-w-0 space-y-4">
        <div className="text-fg-muted flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
          <p>
            {item
              ? `Question ${item.position} · ${item.topicName} · difficulty ${item.difficulty} of 5`
              : "Practice"}
            {` · ${answeredCount} answered this visit`}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void finish()}
            disabled={phase === "loading"}
          >
            Finish practice
          </Button>
        </div>

        {phase === "loading" ? <LoadingState label="Loading the next question" lines={4} /> : null}

        {phase === "error" ? (
          <ErrorState
            title="Something went wrong"
            action={
              <Button onClick={goNext} variant="secondary">
                Load the question again
              </Button>
            }
          >
            {error}
          </ErrorState>
        ) : null}

        {phase === "empty" ? (
          <div className="space-y-3">
            <p className="text-fg text-sm">{message}</p>
            <Button variant="primary" onClick={() => void finish()}>
              See practice summary
            </Button>
          </div>
        ) : null}

        {item && (phase === "answering" || phase === "feedback") ? (
          <section aria-labelledby={`${answerId}-h`} className="space-y-4">
            <div>
              <h2
                id={`${answerId}-h`}
                ref={headingRef}
                tabIndex={-1}
                className="text-fg text-base font-semibold focus:outline-none"
              >
                {TYPE_LABEL[item.type]}
              </h2>
              {item.scaffoldNote ? (
                <p className="text-fg-muted mt-1 text-sm">{item.scaffoldNote}</p>
              ) : null}
              {!item.reviewed ? (
                <p className="text-fg-subtle mt-1 text-xs">
                  Generated for this session and not yet reviewed by your instructor.
                </p>
              ) : null}
            </div>
            <div className="max-w-[68ch] text-lg">
              <Markdown className="text-base">{item.prompt}</Markdown>
            </div>
            {item.type === "TRACE" && item.starterCode ? (
              <pre className="border-border bg-surface-2 max-w-[68ch] overflow-x-auto rounded-md border p-3 font-mono text-code leading-5">
                {item.starterCode}
              </pre>
            ) : null}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              className="space-y-3"
            >
              {item.type === "MULTIPLE_CHOICE" && item.choices ? (
                <fieldset disabled={locked} className="space-y-1.5">
                  <legend className="text-fg mb-2 text-sm font-medium">Choose one answer</legend>
                  {item.choices.map((c) => (
                    <label
                      key={c.id}
                      className="border-border bg-surface hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-accent-subtle flex max-w-[68ch] cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <input
                        type="radio"
                        name={`choice-${item.attemptId}`}
                        value={c.id}
                        data-testid="practice-answer"
                        checked={answer === c.id}
                        onChange={() => setAnswer(c.id)}
                        className="accent-accent mt-0.5"
                      />
                      <span>
                        <span className="font-medium">{c.id}.</span> {c.text}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : item.type === "CODING" ? (
                <div
                  data-testid="practice-answer"
                  className="border-border overflow-hidden rounded-lg border"
                >
                  <CodeEditor
                    value={answer}
                    onChange={setAnswer}
                    language={lang}
                    ariaLabel="Practice code editor"
                    readOnly={locked}
                    height="260px"
                  />
                </div>
              ) : (
                <div>
                  <label htmlFor={answerId} className="text-fg mb-1 block text-sm font-medium">
                    {item.type === "TRACE" ? "Predicted output" : "Your answer"}
                  </label>
                  <Textarea
                    id={answerId}
                    data-testid="practice-answer"
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    readOnly={locked}
                    mono={item.type === "TRACE"}
                    rows={item.type === "EXPLAIN" ? 6 : 3}
                    className="max-w-[68ch]"
                  />
                </div>
              )}

              {phase === "answering" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="submit"
                    variant="primary"
                    data-testid="practice-submit"
                    loading={submitting}
                    loadingLabel="Checking…"
                    disabled={answer.trim() === ""}
                  >
                    Check answer
                  </Button>
                  <Button
                    onClick={() => void explain()}
                    loading={explaining}
                    loadingLabel="Loading explanation…"
                  >
                    Explain this
                  </Button>
                  {answer.trim() === "" ? (
                    <span className="text-fg-subtle text-xs">Answer the question to check it.</span>
                  ) : null}
                </div>
              ) : null}
            </form>

            {error ? (
              <p role="alert" className="text-danger text-sm">
                {error}
              </p>
            ) : null}

            {phase === "feedback" && result ? (
              <div
                ref={feedbackRef}
                tabIndex={-1}
                role="status"
                data-testid="practice-feedback"
                className="border-border bg-surface max-w-[68ch] space-y-2 rounded-lg border px-4 py-3 focus:outline-none"
              >
                <p
                  className={
                    result.correct === true
                      ? "text-success text-sm font-semibold"
                      : result.correct === false
                        ? "text-state-reinforce text-sm font-semibold"
                        : "text-fg text-sm font-semibold"
                  }
                >
                  {result.correct === true
                    ? "Correct."
                    : result.correct === false
                      ? "Not quite."
                      : "Compare your answer with the model answer."}
                </p>
                {feedbackBody(result) ? (
                  <p className="text-fg text-sm">{feedbackBody(result)}</p>
                ) : null}
                {result.correctAnswer &&
                result.correct !== true &&
                !result.feedback.includes(result.correctAnswer) ? (
                  <p className="text-fg text-sm">
                    <span className="text-fg-muted">Model answer: </span>
                    <span className="font-mono text-code">{result.correctAnswer}</span>
                  </p>
                ) : null}
                {result.selfAssess ? (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <span className="text-fg-muted text-sm">Did your answer match?</span>
                    <Button size="sm" onClick={() => void selfAssess(true)} disabled={submitting}>
                      Mark mine correct
                    </Button>
                    <Button size="sm" onClick={() => void selfAssess(false)} disabled={submitting}>
                      Mark mine not yet correct
                    </Button>
                  </div>
                ) : (
                  <p className="text-fg-muted text-xs">
                    {difficultyLine(result.difficultyChange, result.scaffoldNext)}
                  </p>
                )}
              </div>
            ) : null}

            {explanation ? (
              <section
                aria-label="Explanation"
                className="border-accent bg-accent-subtle max-w-[68ch] border-l-2 px-3 py-2"
              >
                <p className="text-accent mb-1 text-xs font-medium">Explanation</p>
                <Markdown>{explanation}</Markdown>
              </section>
            ) : null}

            {phase === "feedback" && result && !result.selfAssess ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={goNext}>
                  Next question
                </Button>
                {!explanation ? (
                  <Button
                    onClick={() => void explain()}
                    loading={explaining}
                    loadingLabel="Loading explanation…"
                  >
                    Explain this
                  </Button>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>

      <aside
        aria-label="Socra"
        data-socra-panel
        className="xl:sticky xl:top-4 xl:h-[calc(100vh-8rem)] xl:self-start"
      >
        <SocraPanel
          mode="PRACTICE"
          sessionRequest={{ practiceSessionId: sessionId }}
          getWorkspace={() =>
            item ? { code: answerRef.current, language: item.language ?? null } : null
          }
          contextItems={["the current practice question", "your answer"]}
          className="h-[560px] xl:h-full"
        />
      </aside>
    </div>
  );
}

function PracticeSummaryView({
  summary,
  courseId,
  courseCode,
}: {
  summary: PracticeSummaryDto;
  courseId: string;
  courseCode: string;
}) {
  return (
    <div className="max-w-[860px] space-y-6" data-testid="practice-summary">
      <section>
        <h2 className="text-fg text-base font-semibold">Session summary</h2>
        <p className="text-fg mt-1 text-sm tabular-nums">
          {summary.answered === 0
            ? "No questions were answered in this session."
            : `${summary.correctCount} of ${summary.answered} answered correctly · ${summary.itemsServed} ${summary.itemsServed === 1 ? "question" : "questions"} shown`}
        </p>
        <p className="text-fg-muted mt-0.5 text-xs">
          Your answers were recorded as practice evidence for your learning profile.
        </p>
      </section>
      {summary.topics.length > 0 ? (
        <Table caption="Results by topic">
          <THead>
            <TR>
              <TH>Topic</TH>
              <TH numeric>Answered</TH>
              <TH numeric>Correct</TH>
            </TR>
          </THead>
          <TBody>
            {summary.topics.map((t) => (
              <TR key={t.topicId}>
                <TD>{t.name}</TD>
                <TD numeric>{t.answered}</TD>
                <TD numeric>{t.correct}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : null}
      {summary.followUps.length > 0 ? (
        <section>
          <h2 className="text-fg text-base font-semibold">Worth practicing again</h2>
          <ul className="mt-2 space-y-2">
            {summary.followUps.map((f) => (
              <li
                key={f.topicId}
                className="flex flex-wrap items-center justify-between gap-3 text-sm"
              >
                <span>
                  <span className="text-fg font-medium">{f.name}</span>
                  <span className="text-fg-muted"> · {f.reason}</span>
                </span>
                <LinkButton
                  href={`/practice?courseId=${encodeURIComponent(courseId)}&topicId=${encodeURIComponent(f.topicId)}`}
                  size="sm"
                >
                  Practice {f.name}
                </LinkButton>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <LinkButton href={`/practice?courseId=${encodeURIComponent(courseId)}`} variant="primary">
          Start another {courseCode} session
        </LinkButton>
        <LinkButton href="/profile">View learning profile</LinkButton>
      </div>
    </div>
  );
}
