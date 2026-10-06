"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SocraPanel } from "@/components/socra/socra-panel";
import { apiJson, formatDateTime, newIdempotencyKey } from "./api";
import { Button, Dialog } from "@/components/ui";
import { Markdown } from "./markdown";
import { ModeBanner, saveStatusText } from "./mode-banner";
import { QuestionPane } from "./question-pane";
import type { SaveStatus, StudentRunDto, SubmissionSummaryDto, WorkspaceDto } from "./types";

interface SaveInfo {
  status: SaveStatus;
  savedAt: Date | null;
}

function submitKeyStorage(assignmentId: string) {
  return `socra:submit-key:${assignmentId}`;
}

export function AssignmentWorkspace({ data }: { data: WorkspaceDto }) {
  const { assignmentId, questions, mode } = data;
  const closed = data.state === "CLOSED" || data.state === "ARCHIVED";
  const [activeId, setActiveId] = useState(questions[0]?.id ?? "");
  const contents = useRef<Record<string, string>>({});
  const flushers = useRef<Record<string, () => Promise<void>>>({});
  const [saves, setSaves] = useState<Record<string, SaveInfo>>({});
  const [, setRuns] = useState<Record<string, StudentRunDto>>({});

  const [attemptsUsed, setAttemptsUsed] = useState(data.attemptsUsed);
  const [latestSubmission, setLatestSubmission] = useState<SubmissionSummaryDto | null>(
    data.latestSubmission,
  );
  const [confirmation, setConfirmation] = useState<SubmissionSummaryDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [progressStatus, setProgressStatus] = useState(data.progressStatus);
  const idemKey = useRef<string | null>(null);
  const confirmationRef = useRef<HTMLDivElement>(null);
  const keepWorkingRef = useRef<HTMLButtonElement>(null);

  const onContent = useCallback((qid: string, c: string) => {
    contents.current[qid] = c;
  }, []);
  const onSaveState = useCallback((qid: string, status: SaveStatus, savedAt: Date | null) => {
    setSaves((s) =>
      s[qid]?.status === status && s[qid]?.savedAt === savedAt
        ? s
        : { ...s, [qid]: { status, savedAt } },
    );
  }, []);
  const onLatestRun = useCallback((qid: string, run: StudentRunDto) => {
    setRuns((r) => ({ ...r, [qid]: run }));
  }, []);
  const registerFlush = useCallback((qid: string, fn: () => Promise<void>) => {
    flushers.current[qid] = fn;
  }, []);

  // Aggregate save status: the worst state across questions wins.
  const aggregateSave = ((): SaveInfo => {
    const list = Object.values(saves);
    const order: SaveStatus[] = ["conflict", "error", "offline", "saving", "saved", "idle"];
    for (const st of order) {
      const hit = list.filter((s) => s.status === st);
      if (hit.length) {
        const latest = hit
          .map((h) => h.savedAt)
          .filter((d): d is Date => d !== null)
          .sort((a, b) => b.getTime() - a.getTime())[0];
        return { status: st, savedAt: latest ?? null };
      }
    }
    return { status: "idle", savedAt: null };
  })();

  const attemptsLeft =
    data.attemptLimit === null ? null : Math.max(0, data.attemptLimit - attemptsUsed);
  const outOfAttempts = attemptsLeft !== null && attemptsLeft <= 0;
  const resubmitBlocked = !data.allowResubmission && attemptsUsed > 0;
  const submitBlockedReason = closed
    ? "This assignment is closed, so new submissions are not accepted."
    : outOfAttempts
      ? "You have used all of your attempts for this assignment."
      : resubmitBlocked
        ? "This assignment accepts one submission, and you have already submitted."
        : !data.canSubmit
          ? (data.submitBlockedReason ?? "Submissions are not open for this assignment.")
          : null;

  const [answeredCount, setAnsweredCount] = useState(0);

  const openSubmit = () => {
    setSubmitError(null);
    setAnsweredCount(
      questions.filter((q) => {
        const c = (contents.current[q.id] ?? q.draft?.content ?? "").trim();
        return c !== "" && c !== q.starterCode.trim();
      }).length,
    );
    if (!idemKey.current) {
      let stored: string | null = null;
      try {
        stored = window.sessionStorage.getItem(submitKeyStorage(assignmentId));
      } catch {
        stored = null;
      }
      idemKey.current = stored ?? newIdempotencyKey();
      try {
        window.sessionStorage.setItem(submitKeyStorage(assignmentId), idemKey.current);
      } catch {
        /* storage unavailable; the in-memory key still dedupes retries in this tab */
      }
    }
    setDialogOpen(true);
  };

  const doSubmit = async () => {
    if (submitting || !idemKey.current) return;
    setSubmitting(true);
    setSubmitError(null);
    // Best-effort flush of pending autosaves; the submission carries the content itself, so it never waits on them.
    await Promise.race([
      Promise.allSettled(Object.values(flushers.current).map((f) => f())),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
    const answers = questions.map((q) => ({
      questionId: q.id,
      content: contents.current[q.id] ?? q.draft?.content ?? q.starterCode,
    }));
    const res = await apiJson<{
      submissionId: string;
      attemptNumber: number;
      submittedAt: string;
      status: string;
    }>("/api/submissions", {
      method: "POST",
      body: { assignmentId, idempotencyKey: idemKey.current, answers },
    });
    setSubmitting(false);
    if (res.ok) {
      const sub: SubmissionSummaryDto = {
        submissionId: res.data.submissionId,
        attemptNumber: res.data.attemptNumber,
        submittedAt: res.data.submittedAt,
        status: res.data.status,
      };
      idemKey.current = null;
      try {
        window.sessionStorage.removeItem(submitKeyStorage(assignmentId));
      } catch {
        /* ignore */
      }
      setAttemptsUsed((n) => Math.max(n, sub.attemptNumber));
      setLatestSubmission(sub);
      setConfirmation(sub);
      setProgressStatus("SUBMITTED");
      setDialogOpen(false);
      return;
    }
    setDialogOpen(false);
    setSubmitError(
      res.status === 0
        ? "Couldn't reach the server, so nothing was submitted yet. Your work is kept on this device. Submit again when you're back online; it will not create a duplicate."
        : `Submission failed: ${res.error.message}. Your work is saved. Try submitting again; a retry will not create a duplicate.`,
    );
  };

  useEffect(() => {
    if (confirmation) confirmationRef.current?.focus();
  }, [confirmation]);

  const contextFor = (type: string) => {
    const items = ["the assignment prompt"];
    if (type === "CODING") items.push("your current code", "your last run", "public test results");
    else items.push("your current answer");
    if (mode === "POST_ASSESSMENT_REVIEW" && data.solutionsReleased)
      items.push("the released solution");
    return items;
  };

  const activeQuestion = questions.find((q) => q.id === activeId) ?? questions[0];

  return (
    <div className="space-y-4">
      <ModeBanner
        mode={mode}
        state={data.state}
        solutionsReleased={data.solutionsReleased}
        progressStatus={progressStatus}
        dueAt={data.dueAt}
        overdue={data.overdue}
        closeAt={data.closeAt}
        saveStatus={aggregateSave.status}
        savedAt={aggregateSave.savedAt}
        attemptsLeft={attemptsLeft}
      />

      {confirmation ? (
        <div
          ref={confirmationRef}
          tabIndex={-1}
          role="status"
          data-testid="submission-confirmation"
          className="border-border bg-success-bg rounded-lg border px-4 py-3"
        >
          <p className="text-success text-sm font-semibold">
            Attempt {confirmation.attemptNumber} submitted at{" "}
            {formatDateTime(confirmation.submittedAt)}.
          </p>
          <p className="text-fg mt-0.5 text-sm">
            Your code and answers were saved as an immutable snapshot.
            {mode === "PROTECTED_ASSESSMENT" && !closed
              ? " Socra stays in protected mode until the assignment closes."
              : ""}
            {attemptsLeft !== null
              ? ` ${attemptsLeft} ${attemptsLeft === 1 ? "attempt" : "attempts"} left.`
              : ""}
          </p>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          {data.description.trim() ? (
            <section aria-label="Assignment instructions" className="max-w-[68ch]">
              <Markdown>{data.description}</Markdown>
            </section>
          ) : null}

          {data.socraAvailable && questions.length > 0 ? (
            <p className="xl:hidden">
              <a href="#socra-panel" className="text-accent text-sm underline underline-offset-2">
                Jump to Socra
              </a>
            </p>
          ) : null}

          {questions.length > 1 ? (
            <nav aria-label="Questions" className="border-border border-b">
              <ul className="-mb-px flex flex-wrap gap-4">
                {questions.map((q, i) => {
                  const s = saves[q.id]?.status;
                  return (
                    <li key={q.id}>
                      <button
                        type="button"
                        onClick={() => setActiveId(q.id)}
                        aria-current={q.id === activeId ? "true" : undefined}
                        className={
                          q.id === activeId
                            ? "border-accent text-fg h-9 border-b-2 text-sm font-medium"
                            : "text-fg-muted hover:text-fg h-9 border-b-2 border-transparent text-sm"
                        }
                      >
                        Question {i + 1}
                        {s === "offline" || s === "conflict" || s === "error" ? (
                          <span className="text-warning ml-1 text-xs">(not saved)</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : null}

          {questions.length === 0 ? (
            <p className="text-fg-muted text-sm">
              This assignment has no questions yet. Check back after your instructor publishes them.
            </p>
          ) : (
            questions.map((q, i) => (
              <QuestionPane
                key={q.id}
                assignmentId={assignmentId}
                question={q}
                index={i}
                total={questions.length}
                hidden={q.id !== activeId}
                readOnly={closed}
                onContent={onContent}
                onSaveState={onSaveState}
                onLatestRun={onLatestRun}
                registerFlush={registerFlush}
              />
            ))
          )}

          <section
            aria-label="Submission"
            className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-4"
          >
            <div className="text-fg-muted text-xs">
              {latestSubmission ? (
                <p>
                  Last submitted: attempt {latestSubmission.attemptNumber},{" "}
                  {formatDateTime(latestSubmission.submittedAt)}
                </p>
              ) : (
                <p>Not submitted yet. Drafts are saved automatically and are not graded.</p>
              )}
              {submitBlockedReason ? <p className="text-fg mt-0.5">{submitBlockedReason}</p> : null}
            </div>
            {closed ? null : (
              <Button
                variant="primary"
                size="lg"
                data-testid="submit-button"
                onClick={openSubmit}
                disabled={submitBlockedReason !== null || submitting || questions.length === 0}
              >
                {latestSubmission ? "Resubmit assignment" : "Submit assignment"}
              </Button>
            )}
          </section>
          {submitError ? (
            <p role="alert" className="text-danger text-sm">
              {submitError}
            </p>
          ) : null}
        </div>

        <aside
          aria-label="Socra"
          id="socra-panel"
          data-socra-panel
          className="xl:sticky xl:top-4 xl:h-[calc(100vh-8rem)] xl:self-start"
        >
          {questions.map((q) => (
            <div key={q.id} hidden={q.id !== activeQuestion?.id} className="h-[560px] xl:h-full">
              <SocraPanel
                mode={mode}
                active={q.id === activeQuestion?.id}
                available={data.socraAvailable}
                sessionRequest={{ assignmentId, questionId: q.id }}
                getWorkspace={() => ({
                  code: contents.current[q.id] ?? q.draft?.content ?? q.starterCode,
                  language: q.language,
                })}
                contextItems={contextFor(q.type)}
                questionType={q.type}
                showPolicy={false}
                scopeLabel={
                  questions.length > 1 ? `About question ${questions.indexOf(q) + 1}` : undefined
                }
                className="h-full"
              />
            </div>
          ))}
        </aside>
      </div>

      <Dialog
        open={dialogOpen}
        title={latestSubmission ? "Resubmit this assignment?" : "Submit this assignment?"}
        initialFocus={keepWorkingRef}
        onClose={() => {
          if (!submitting) setDialogOpen(false);
        }}
        footer={
          <>
            <Button ref={keepWorkingRef} onClick={() => setDialogOpen(false)} disabled={submitting}>
              Keep working
            </Button>
            <Button
              variant="primary"
              data-testid="submit-confirm"
              loading={submitting}
              loadingLabel="Submitting…"
              onClick={() => void doSubmit()}
            >
              {`Submit attempt ${attemptsUsed + 1}`}
            </Button>
          </>
        }
      >
        <p>
          This submits what is in the {questions.length === 1 ? "editor" : "editors"} right now as
          attempt {attemptsUsed + 1}
          {data.attemptLimit !== null ? ` of ${data.attemptLimit}` : ""}.
        </p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5">
          <li>
            {answeredCount} of {questions.length}{" "}
            {questions.length === 1 ? "question" : "questions"} changed from the starter.
          </li>
          <li>Draft status: {saveStatusText(aggregateSave.status, aggregateSave.savedAt)}.</li>
          {mode === "PROTECTED_ASSESSMENT" ? (
            <li>Socra stays in protected mode after you submit, until the assignment closes.</li>
          ) : null}
          {attemptsLeft !== null && attemptsLeft - 1 >= 0 ? (
            <li>
              After this, {attemptsLeft - 1} {attemptsLeft - 1 === 1 ? "attempt" : "attempts"} left.
            </li>
          ) : null}
        </ul>
      </Dialog>
    </div>
  );
}
