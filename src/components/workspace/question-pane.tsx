"use client";

import { buttonClasses } from "@/components/ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { FlaskConical, Play } from "lucide-react";
import { apiJson } from "./api";
import { CodeEditor } from "./code-editor";
import { Markdown } from "./markdown";
import { RunConsole, type ConsoleTab } from "./run-console";
import { useAutosave } from "./use-autosave";
import {
  LANGUAGE_FILE,
  LANGUAGE_LABELS,
  type SaveStatus,
  type StudentRunDto,
  type WorkspaceQuestionDto,
} from "./types";

/** Map POST /api/runs (StudentRunResult) into the client DTO. */
export function toRunDto(raw: unknown, kind: "RUN" | "PUBLIC_TESTS"): StudentRunDto {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const tests = Array.isArray(r.testResults)
    ? (r.testResults as Array<Record<string, unknown>>)
    : [];
  return {
    runId: String(r.runId ?? r.id ?? ""),
    kind,
    status: (r.status as StudentRunDto["status"]) ?? "INTERNAL_ERROR",
    stdout: typeof r.stdout === "string" ? r.stdout : "",
    stderr: typeof r.stderr === "string" ? r.stderr : "",
    exitCode: typeof r.exitCode === "number" ? r.exitCode : null,
    durationMs: typeof r.durationMs === "number" ? r.durationMs : null,
    truncated: r.truncated === true,
    completedAt: typeof r.completedAt === "string" ? r.completedAt : new Date().toISOString(),
    testResults: tests.map((t) => ({
      testId: String(t.testId ?? t.id ?? t.name ?? ""),
      name: String(t.name ?? "Test"),
      passed: t.passed === true,
      actual: t.actual === undefined || t.actual === null ? undefined : String(t.actual),
      expected: t.expected === undefined || t.expected === null ? undefined : String(t.expected),
      message: typeof t.message === "string" ? t.message : undefined,
    })),
  };
}

export interface QuestionPaneProps {
  assignmentId: string;
  question: WorkspaceQuestionDto;
  index: number;
  total: number;
  hidden: boolean;
  /** Editing disabled (assignment closed). Running code still works. */
  readOnly: boolean;
  onContent: (questionId: string, content: string) => void;
  onSaveState: (questionId: string, status: SaveStatus, savedAt: Date | null) => void;
  onLatestRun: (questionId: string, run: StudentRunDto) => void;
  registerFlush: (questionId: string, flush: () => Promise<void>) => void;
}

export function QuestionPane(props: QuestionPaneProps) {
  const {
    assignmentId,
    question,
    index,
    total,
    hidden,
    readOnly,
    onContent,
    onSaveState,
    onLatestRun,
    registerFlush,
  } = props;
  const isCode = question.type === "CODING";
  const autosave = useAutosave({
    assignmentId,
    questionId: question.id,
    initialDraft: question.draft,
    starterContent: question.starterCode,
    readOnly,
  });
  const { content, status, savedAt, setContent, flush } = autosave;

  useEffect(() => onContent(question.id, content), [question.id, content, onContent]);
  useEffect(
    () => onSaveState(question.id, status, savedAt),
    [question.id, status, savedAt, onSaveState],
  );
  useEffect(() => registerFlush(question.id, flush), [question.id, flush, registerFlush]);

  const initialRun = question.latestRun;
  const [run, setRun] = useState<StudentRunDto | null>(
    initialRun && initialRun.kind === "RUN" ? initialRun : null,
  );
  const [testRun, setTestRun] = useState<StudentRunDto | null>(
    initialRun && initialRun.kind === "PUBLIC_TESTS" ? initialRun : null,
  );
  const [tab, setTab] = useState<ConsoleTab>(
    initialRun?.kind === "PUBLIC_TESTS" ? "tests" : "output",
  );
  const [running, setRunning] = useState<"RUN" | "PUBLIC_TESTS" | null>(null);
  const [errors, setErrors] = useState<{ RUN: string | null; PUBLIC_TESTS: string | null }>({
    RUN: null,
    PUBLIC_TESTS: null,
  });
  const runningRef = useRef(false);
  const contentRef = useRef(content);
  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const execute = useCallback(
    async (kind: "RUN" | "PUBLIC_TESTS") => {
      if (!isCode || runningRef.current) return;
      runningRef.current = true;
      setRunning(kind);
      setTab(kind === "RUN" ? "output" : "tests");
      setErrors((e) => ({ ...e, [kind]: null }));
      const res = await apiJson<unknown>("/api/runs", {
        method: "POST",
        body: { assignmentId, questionId: question.id, code: contentRef.current, kind },
      });
      runningRef.current = false;
      setRunning(null);
      if (res.ok) {
        const dto = toRunDto(res.data, kind);
        if (kind === "RUN") setRun(dto);
        else setTestRun(dto);
        onLatestRun(question.id, dto);
        return;
      }
      const msg =
        res.status === 0
          ? "Couldn't reach the server to run your code. Your work is kept on this device. Run again when you're back online."
          : res.status === 429
            ? "Too many runs in a short time. Wait a few seconds, then run again. Your work is saved."
            : res.status === 503
              ? "Code runner is unavailable right now. Your work is saved."
              : `Couldn't run your code (${res.error.message}). Your work is saved. Run again.`;
      setErrors((e) => ({ ...e, [kind]: msg }));
    },
    [assignmentId, question.id, isCode, onLatestRun],
  );

  const runCode = useCallback(() => void execute("RUN"), [execute]);
  const hasPublicTests = question.publicTests.length > 0;
  const promptId = useId();
  const shortcutId = useId();

  return (
    <div
      hidden={hidden}
      onKeyDown={(e) => {
        if (!isCode || e.defaultPrevented) return;
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
          const target = e.target as HTMLElement;
          if (target.closest("[data-socra-panel]")) return;
          e.preventDefault();
          runCode();
        }
      }}
      className="space-y-4"
    >
      <section aria-labelledby={promptId}>
        <h2 id={promptId} className="text-fg text-base font-semibold">
          {total > 1 ? `Question ${index + 1}: ` : ""}
          {question.title}
          {question.points > 0 ? (
            <span className="text-fg-muted ml-2 text-xs font-normal tabular-nums">
              {question.points} {question.points === 1 ? "point" : "points"}
            </span>
          ) : null}
        </h2>
        <div className="mt-2 max-w-[68ch]">
          <Markdown>{question.prompt}</Markdown>
        </div>
        {question.publicTests.length > 0 ? (
          <details className="mt-3 max-w-[68ch] text-sm">
            <summary className="text-fg-muted hover:text-fg cursor-pointer">
              Public test cases ({question.publicTests.length})
            </summary>
            <ul className="mt-2 space-y-1 font-mono text-code">
              {question.publicTests.map((t) => (
                <li key={t.id}>
                  <span className="text-fg">{t.input}</span>
                  <span className="text-fg-subtle"> expected </span>
                  <span className="text-fg">{t.expected}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {autosave.conflict ? (
        <div
          role="alert"
          className="border-border bg-warning-bg flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
        >
          <p className="text-warning text-sm">
            A newer version of this answer was saved from another tab or device. Choose which copy
            to keep.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={autosave.keepMine}
              className={buttonClasses("secondary", "md")}
            >
              Keep mine
            </button>
            <button
              type="button"
              onClick={autosave.acceptSaved}
              className={buttonClasses("secondary", "md")}
            >
              Use saved
            </button>
          </div>
        </div>
      ) : null}
      {autosave.restoredFromDevice && !autosave.conflict ? (
        <p role="status" className="text-fg-muted text-xs">
          Restored changes from this device that had not reached the server yet.
        </p>
      ) : null}

      {isCode ? (
        <>
          <div className="border-border bg-surface overflow-hidden rounded-lg border">
            <div className="border-border bg-surface-2 flex min-h-10 flex-wrap items-center justify-between gap-2 border-b px-3 py-1">
              <p className="text-fg-muted truncate text-xs">
                <span className="text-fg font-mono">
                  {question.language ? LANGUAGE_FILE[question.language] : "main"}
                </span>
                {question.language ? ` · ${LANGUAGE_LABELS[question.language]}` : ""}
                {readOnly ? " · read only" : ""}
              </p>
              <div role="group" aria-label="Run" className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid={hidden ? undefined : "run-button"}
                  onClick={runCode}
                  disabled={running !== null}
                  className={buttonClasses("secondary", "md")}
                >
                  <Play size={14} strokeWidth={1.75} aria-hidden="true" />
                  {running === "RUN" ? "Running…" : "Run code"}
                </button>
                {hasPublicTests ? (
                  <button
                    type="button"
                    data-testid={hidden ? undefined : "run-tests-button"}
                    onClick={() => void execute("PUBLIC_TESTS")}
                    disabled={running !== null}
                    className={buttonClasses("secondary", "md")}
                  >
                    <FlaskConical size={14} strokeWidth={1.75} aria-hidden="true" />
                    {running === "PUBLIC_TESTS" ? "Running tests…" : "Run public tests"}
                  </button>
                ) : null}
              </div>
            </div>
            <div data-testid={hidden ? undefined : "editor"}>
              <CodeEditor
                value={content}
                onChange={setContent}
                language={question.language}
                ariaLabel={`Code editor, ${total > 1 ? `question ${index + 1}, ` : ""}${question.title}`}
                readOnly={readOnly}
                onRun={runCode}
                describedBy={shortcutId}
              />
            </div>
          </div>
          <p id={shortcutId} className="text-fg-subtle -mt-2 hidden text-xs md:block">
            <kbd className="border-border bg-surface rounded-sm border px-1 font-mono">Ctrl+Enter</kbd>{" "}
            runs ·{" "}
            <kbd className="border-border bg-surface rounded-sm border px-1 font-mono">Esc</kbd>{" "}
            then{" "}
            <kbd className="border-border bg-surface rounded-sm border px-1 font-mono">Tab</kbd>{" "}
            leaves the editor
          </p>
          <RunConsole
            tab={tab}
            onTabChange={setTab}
            run={run}
            testRun={testRun}
            running={running}
            errors={errors}
            publicTests={question.publicTests}
            withTestIds={!hidden}
          />
        </>
      ) : question.type === "MULTIPLE_CHOICE" && question.choices ? (
        <fieldset className="space-y-1" data-testid={hidden ? undefined : "editor"}>
          <legend className="text-fg mb-2 text-sm font-medium">Choose one answer</legend>
          {question.choices.map((c) => (
            <label
              key={c.id}
              className="border-border bg-surface hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-accent-subtle flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <input
                type="radio"
                name={`q-${question.id}`}
                value={c.id}
                checked={content === c.id}
                disabled={readOnly}
                onChange={() => setContent(c.id)}
                className="mt-0.5 accent-[var(--color-accent)]"
              />
              <span>{c.label}</span>
            </label>
          ))}
        </fieldset>
      ) : (
        <WrittenEditor
          testId={hidden ? undefined : "editor"}
          value={content}
          onChange={setContent}
          readOnly={readOnly}
          label={`Your answer${total > 1 ? ` to question ${index + 1}` : ""}`}
        />
      )}
      {question.answerReview ? (
        <section
          aria-label={`Answer explanation${total > 1 ? ` for question ${index + 1}` : ""}`}
          className="border-border bg-surface-2 space-y-1 rounded-md border px-3 py-2 text-sm"
          data-testid={hidden ? undefined : "answer-review"}
        >
          {question.answerReview.correctAnswer ? (
            <p className="text-fg">
              <span className="font-semibold">Correct answer: </span>
              {question.answerReview.correctAnswer}
            </p>
          ) : null}
          {question.answerReview.explanation ? (
            <div className="text-fg-muted">
              <Markdown>{question.answerReview.explanation}</Markdown>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function WrittenEditor({
  testId,
  value,
  onChange,
  readOnly,
  label,
}: {
  testId?: string;
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
  label: string;
}) {
  const id = useId();
  const helpId = useId();
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  return (
    <div data-testid={testId}>
      <label htmlFor={id} className="text-fg mb-1 block text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        aria-describedby={helpId}
        rows={14}
        className="border-border-input bg-surface text-fg read-only:bg-surface-2 block w-full resize-y rounded-md border px-3 py-2 text-sm leading-6"
      />
      <p id={helpId} className="text-fg-subtle mt-1 text-xs tabular-nums">
        {words} {words === 1 ? "word" : "words"} · saved automatically as you type
      </p>
    </div>
  );
}
