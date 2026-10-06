import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";

/** One sentence on what will appear here, plus one action. No illustration, no "Oops". */
export function EmptyState({
  children,
  action,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border-strong px-4 py-4 text-sm text-fg-muted",
        className,
      )}
    >
      <p>{children}</p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * Says what failed, whether work was saved, and what to do. Announced via role="alert".
 * Uses a left stripe because it is a real status (guardrails V13).
 */
export function ErrorState({
  title,
  children,
  action,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cx(
        "flex items-start gap-2 rounded-md border border-l-2 border-border border-l-danger bg-danger-bg px-3 py-2.5 text-sm",
        className,
      )}
    >
      <AlertCircle
        aria-hidden="true"
        size={16}
        strokeWidth={1.75}
        className="mt-0.5 shrink-0 text-danger"
      />
      <div className="min-w-0 space-y-1">
        <p className="font-medium text-fg">{title}</p>
        {children ? <div className="text-fg-muted">{children}</div> : null}
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  );
}

const SKELETON_WIDTHS = ["w-11/12", "w-8/12", "w-10/12", "w-6/12", "w-9/12"];

/** Static skeleton lines (no shimmer) plus a screen-reader label. Size `lines` to the real content. */
export function LoadingState({
  label = "Loading",
  lines = 3,
  className,
}: {
  label?: string;
  lines?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-live="polite" className={cx("space-y-2.5 py-1", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          aria-hidden="true"
          className={cx("h-3 rounded-sm bg-surface-2", SKELETON_WIDTHS[i % SKELETON_WIDTHS.length])}
        />
      ))}
    </div>
  );
}

/** Inline loading text for small regions ("Loading submissions…"). */
export function LoadingText({ children = "Loading…" }: { children?: ReactNode }) {
  return (
    <p role="status" aria-live="polite" className="text-sm text-fg-muted">
      {children}
    </p>
  );
}
