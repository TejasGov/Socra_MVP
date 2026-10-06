"use client";

import { useId } from "react";
import type { PublicTestDto, StudentRunDto } from "./types";

const STATUS_TEXT: Record<string, string> = {
  OK: "Finished",
  COMPILE_ERROR: "Compile error",
  RUNTIME_ERROR: "Runtime error",
  TIMEOUT: "Stopped: time limit reached",
  MEMORY_LIMIT: "Stopped: memory limit reached",
  OUTPUT_LIMIT: "Stopped: output limit reached",
  INTERNAL_ERROR: "The runner hit an internal error",
  QUEUED: "Queued",
  RUNNING: "Running",
};

export type ConsoleTab = "output" | "tests";

export interface RunConsoleProps {
  tab: ConsoleTab;
  onTabChange: (tab: ConsoleTab) => void;
  run: StudentRunDto | null;
  testRun: StudentRunDto | null;
  running: "RUN" | "PUBLIC_TESTS" | null;
  /** Set when POST /api/runs itself failed (network or server error), per run kind. */
  errors: { RUN: string | null; PUBLIC_TESTS: string | null };
  publicTests: PublicTestDto[];
  /** Only the visible question carries E2E test ids. */
  withTestIds?: boolean;
}

function RunnerUnavailable() {
  return (
    <p role="alert" className="text-fg text-sm">
      Code runner is unavailable right now. Your work is saved.
    </p>
  );
}

function OutputPanel({
  run,
  running,
  requestError,
}: {
  run: StudentRunDto | null;
  running: boolean;
  requestError: string | null;
}) {
  if (running) return <p className="text-fg-muted text-sm">Running your code…</p>;
  if (requestError)
    return (
      <p role="alert" className="text-danger text-sm">
        {requestError}
      </p>
    );
  if (!run)
    return (
      <p className="text-fg-muted text-sm">
        Output from your program appears here. Run your code with the Run button or Ctrl+Enter.
      </p>
    );
  if (run.status === "RUNNER_UNAVAILABLE") return <RunnerUnavailable />;
  const failed = run.status !== "OK" || (run.exitCode !== null && run.exitCode !== 0);
  return (
    <div className="space-y-2">
      <p className="text-fg-subtle text-xs tabular-nums">
        <span className={failed ? "text-danger font-medium" : "text-fg-muted"}>
          {STATUS_TEXT[run.status] ?? run.status}
        </span>
        {run.exitCode !== null ? ` · exit code ${run.exitCode}` : ""}
        {run.durationMs !== null ? ` · ${run.durationMs} ms` : ""}
        {run.truncated ? " · output truncated at the limit" : ""}
      </p>
      {run.stdout ? (
        <pre className="text-fg font-mono text-[13px] leading-5 whitespace-pre-wrap">
          {run.stdout}
        </pre>
      ) : null}
      {run.stderr ? (
        <pre
          aria-label="Errors"
          className="text-danger font-mono text-[13px] leading-5 whitespace-pre-wrap"
        >
          {run.stderr}
        </pre>
      ) : null}
      {!run.stdout && !run.stderr ? (
        <p className="text-fg-muted text-sm">The program finished without printing anything.</p>
      ) : null}
    </div>
  );
}

function TestsPanel({
  run,
  running,
  requestError,
  publicTests,
}: {
  run: StudentRunDto | null;
  running: boolean;
  requestError: string | null;
  publicTests: PublicTestDto[];
}) {
  if (running) return <p className="text-fg-muted text-sm">Running public tests…</p>;
  if (requestError)
    return (
      <p role="alert" className="text-danger text-sm">
        {requestError}
      </p>
    );
  if (publicTests.length === 0 && !run)
    return <p className="text-fg-muted text-sm">This question has no public tests.</p>;
  if (!run)
    return (
      <p className="text-fg-muted text-sm">
        {publicTests.length} public {publicTests.length === 1 ? "test" : "tests"} available. Run
        them to compare your output with the expected values.
      </p>
    );
  if (run.status === "RUNNER_UNAVAILABLE") return <RunnerUnavailable />;
  const passed = run.testResults.filter((r) => r.passed).length;
  const inputFor = new Map(publicTests.map((t) => [t.id, t] as const));
  return (
    <div className="space-y-2">
      <p className="text-fg-muted text-xs tabular-nums">
        {passed} of {run.testResults.length} public tests passed
        {run.status !== "OK" ? ` · ${STATUS_TEXT[run.status] ?? run.status}` : ""}
        {run.durationMs !== null ? ` · ${run.durationMs} ms` : ""}
      </p>
      {run.testResults.length === 0 && run.stderr ? (
        <pre className="text-danger font-mono text-[13px] leading-5 whitespace-pre-wrap">
          {run.stderr}
        </pre>
      ) : null}
      {run.testResults.length > 0 ? (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2 text-fg-muted text-left text-xs font-medium">
              <th scope="col" className="px-2 py-1.5 font-medium">
                Test
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Input
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Expected
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Actual
              </th>
              <th scope="col" className="px-2 py-1.5 font-medium">
                Result
              </th>
            </tr>
          </thead>
          <tbody>
            {run.testResults.map((r) => {
              const spec = inputFor.get(r.testId);
              return (
                <tr key={r.testId} className="border-border border-b align-top">
                  <td className="px-2 py-2">{r.name}</td>
                  <td className="px-2 py-2 font-mono text-[13px] break-all">{spec?.input ?? ""}</td>
                  <td className="px-2 py-2 font-mono text-[13px] break-all">
                    {r.expected ?? spec?.expected ?? ""}
                  </td>
                  <td className="px-2 py-2 font-mono text-[13px] break-all">
                    {r.actual ?? ""}
                    {!r.passed && r.message ? (
                      <span className="text-fg-muted mt-1 block font-sans text-xs">
                        {r.message}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-2 py-2">
                    <span
                      className={
                        r.passed
                          ? "bg-success-bg text-success rounded-sm px-1.5 py-0.5 text-xs font-medium"
                          : "bg-danger-bg text-danger rounded-sm px-1.5 py-0.5 text-xs font-medium"
                      }
                    >
                      {r.passed ? "Passed" : "Failed"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

export function RunConsole(props: RunConsoleProps) {
  const {
    tab,
    onTabChange,
    run,
    testRun,
    running,
    errors,
    publicTests,
    withTestIds = true,
  } = props;
  const baseId = useId();
  const tabs: Array<{ id: ConsoleTab; label: string }> = [
    { id: "output", label: "Output" },
    { id: "tests", label: "Public tests" },
  ];
  return (
    <section aria-label="Run results" className="border-border bg-surface rounded-lg border">
      <div
        role="tablist"
        aria-label="Run results"
        className="border-border flex gap-4 border-b px-3"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${baseId}-${t.id}-tab`}
            aria-selected={tab === t.id}
            aria-controls={`${baseId}-${t.id}`}
            onClick={() => onTabChange(t.id)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                onTabChange(t.id === "output" ? "tests" : "output");
              }
            }}
            tabIndex={tab === t.id ? 0 : -1}
            className={
              tab === t.id
                ? "border-accent text-fg -mb-px h-9 border-b-2 text-sm font-medium"
                : "text-fg-muted hover:text-fg -mb-px h-9 border-b-2 border-transparent text-sm"
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-output`}
        aria-labelledby={`${baseId}-output-tab`}
        hidden={tab !== "output"}
        data-testid={withTestIds ? "console-output" : undefined}
        aria-live="polite"
        className="max-h-72 min-h-24 overflow-auto p-3"
      >
        <OutputPanel run={run} running={running === "RUN"} requestError={errors.RUN} />
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-tests`}
        aria-labelledby={`${baseId}-tests-tab`}
        hidden={tab !== "tests"}
        data-testid={withTestIds ? "test-results" : undefined}
        aria-live="polite"
        className="max-h-72 min-h-24 overflow-auto p-3"
      >
        <TestsPanel
          run={testRun}
          running={running === "PUBLIC_TESTS"}
          requestError={errors.PUBLIC_TESTS}
          publicTests={publicTests}
        />
      </div>
    </section>
  );
}
