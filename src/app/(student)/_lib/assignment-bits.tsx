import { Badge, DateText, ModeTag, bannerModeFor, formatDue, fullTimestamp } from "@/components/ui";
import type { AssignmentCard } from "@/server/domain/assignments/queries";

const FORMAT_LABELS: Record<AssignmentCard["format"], string> = {
  CODING: "Coding",
  WRITTEN: "Written",
  QUIZ: "Quiz",
};

const LANGUAGE_LABELS: Record<string, string> = {
  PYTHON: "Python",
  JAVASCRIPT: "JavaScript",
  SCALA: "Scala",
};

export function formatLabel(a: Pick<AssignmentCard, "format" | "language">): string {
  const f = FORMAT_LABELS[a.format] ?? a.format;
  return a.language ? `${f}, ${LANGUAGE_LABELS[a.language] ?? a.language}` : f;
}

/** Progress status as a neutral badge; overdue is the only warning state. */
export function StatusCell({ a }: { a: AssignmentCard }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge>{a.isClosed && a.progressStatus === "NOT_STARTED" ? "Closed" : a.progressLabel}</Badge>
      {a.isOverdue ? <Badge tone="warning">Overdue</Badge> : null}
    </span>
  );
}

export function DueCell({ a }: { a: Pick<AssignmentCard, "dueAt"> }) {
  if (!a.dueAt) return <span className="text-fg-subtle">No due date</span>;
  return (
    <time dateTime={a.dueAt.toISOString()} title={fullTimestamp(a.dueAt)} className="tabular-nums">
      {formatDue(a.dueAt)}
    </time>
  );
}

export function ModeCell({ a }: { a: Pick<AssignmentCard, "mode"> }) {
  return <ModeTag mode={bannerModeFor(a.mode)} />;
}

export function ScoreCell({ a }: { a: AssignmentCard }) {
  if (!a.score) return <span className="text-fg-subtle">Not released</span>;
  return (
    <span className="tabular-nums">
      {Math.round(a.score.points * 10) / 10} / {a.score.maxPoints}
    </span>
  );
}

export { DateText };
