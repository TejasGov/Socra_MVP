import { BookOpen, Lock, MessagesSquare } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";

export type SocraMode = "protected" | "practice" | "review";

/** Map backend AI-mode enums (PROTECTED_ASSESSMENT / PRACTICE / POST_ASSESSMENT_REVIEW) to banner modes. */
export function bannerModeFor(aiMode: string | null | undefined): SocraMode {
  if (aiMode === "PRACTICE") return "practice";
  if (aiMode === "POST_ASSESSMENT_REVIEW") return "review";
  return "protected";
}

/** PRD §46 copy. */
export const MODE_COPY: Record<SocraMode, { title: string; short: string; body: string }> = {
  protected: {
    title: "Protected learning mode",
    short: "Protected",
    body: "Socra can help you reason, debug, and understand concepts, but it will not complete the protected part of this assignment for you.",
  },
  practice: {
    title: "Practice mode",
    short: "Practice",
    body: "Use Socra as a tutor. Ask for explanations, examples, or complete walkthroughs when you need them.",
  },
  review: {
    title: "Review mode",
    short: "Review",
    body: "This assignment is closed. Socra can now explain complete solutions and help you compare approaches.",
  },
};

export const MODE_ICONS = { protected: Lock, practice: MessagesSquare, review: BookOpen };

/** The Socra policy line (PRD §46). Flat, bordered, quiet. `data-mode` carries the machine value. */
export function ModeBanner({
  mode,
  compact = false,
  children,
  className,
}: {
  mode: SocraMode;
  /** Title only, visually; the body stays available to screen readers. */
  compact?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const { title, body } = MODE_COPY[mode];
  const Icon = MODE_ICONS[mode];
  return (
    <div
      data-testid="mode-banner"
      data-mode={mode}
      role="note"
      aria-label={title}
      className={cx(
        "flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        size={16}
        strokeWidth={1.75}
        className="mt-0.5 shrink-0 text-fg-muted"
      />
      <div className="min-w-0">
        <p className="font-semibold text-fg">{title}</p>
        <p className={cx("text-fg-muted", compact && "sr-only")}>{body}</p>
        {children}
      </div>
    </div>
  );
}

/** Inline mode indicator for table rows: icon + short label, no color coding. */
export function ModeTag({ mode }: { mode: SocraMode }) {
  const Icon = MODE_ICONS[mode];
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-fg-muted"
      title={MODE_COPY[mode].title}
    >
      <Icon aria-hidden="true" size={12} strokeWidth={1.75} />
      {MODE_COPY[mode].short}
    </span>
  );
}
