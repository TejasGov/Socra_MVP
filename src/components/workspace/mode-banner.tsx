import { ModeBanner as UiModeBanner } from "@/components/ui";
import { formatDateTime, formatTime } from "./api";
import type { SaveStatus, StudentAiModeDto } from "./types";

export function saveStatusText(status: SaveStatus, savedAt: Date | null): string {
  switch (status) {
    case "saving":
      return "Saving…";
    case "saved":
      return savedAt ? `Saved ${formatTime(savedAt)}` : "Saved";
    case "offline":
      return "Offline, changes kept on this device";
    case "conflict":
      return "Conflict: a newer version was saved elsewhere";
    case "error":
      return "Not saved to the server. Changes kept on this device";
    default:
      return "No changes yet";
  }
}

const STATUS_LABELS: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  RETURNED: "Returned",
  CLOSED: "Closed",
};

export function ModeBanner({
  mode,
  state,
  solutionsReleased,
  progressStatus,
  dueAt,
  overdue,
  closeAt,
  saveStatus,
  savedAt,
  attemptsLeft,
}: {
  mode: StudentAiModeDto;
  state: string;
  solutionsReleased: boolean;
  progressStatus: string;
  dueAt: string | null;
  /** Computed on the server when the page loads. */
  overdue: boolean;
  closeAt: string | null;
  saveStatus: SaveStatus;
  savedAt: Date | null;
  /** null = unlimited */
  attemptsLeft: number | null;
}) {
  const closed = state === "CLOSED" || state === "ARCHIVED";
  const review = mode === "POST_ASSESSMENT_REVIEW";
  const statusLabel = closed ? "Closed" : (STATUS_LABELS[progressStatus] ?? progressStatus);
  const due = dueAt ? new Date(dueAt) : null;

  return (
    <UiModeBanner mode={review ? "review" : "protected"}>
      {closed && !review && !solutionsReleased ? (
        <p className="text-fg-muted">
          This assignment is closed. Solutions have not been released, so Socra stays in protected
          mode.
        </p>
      ) : null}
      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <div className="flex gap-1">
          <dt className="text-fg-subtle">Status</dt>
          <dd className="text-fg font-medium">{statusLabel}</dd>
        </div>
        {due ? (
          <div className="flex gap-1">
            <dt className="text-fg-subtle">Due</dt>
            <dd className="text-fg tabular-nums" title={due.toString()}>
              {formatDateTime(dueAt)}
              {overdue && !closed ? <span className="text-warning ml-1">(past due)</span> : null}
            </dd>
          </div>
        ) : null}
        {closeAt && !closed ? (
          <div className="flex gap-1">
            <dt className="text-fg-subtle">Closes</dt>
            <dd className="text-fg tabular-nums">{formatDateTime(closeAt)}</dd>
          </div>
        ) : null}
        <div className="flex gap-1">
          <dt className="text-fg-subtle">Attempts left</dt>
          <dd className="text-fg tabular-nums">
            {attemptsLeft === null ? "Unlimited" : attemptsLeft}
          </dd>
        </div>
        {!closed ? (
          <div className="flex gap-1">
            <dt className="text-fg-subtle">Draft</dt>
            <dd
              aria-live="polite"
              data-testid="save-status"
              className={
                saveStatus === "offline" || saveStatus === "conflict" || saveStatus === "error"
                  ? "text-warning font-medium"
                  : "text-fg"
              }
            >
              {saveStatusText(saveStatus, savedAt)}
            </dd>
          </div>
        ) : null}
      </dl>
    </UiModeBanner>
  );
}
