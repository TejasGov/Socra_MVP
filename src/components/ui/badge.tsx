import { CircleCheck, CircleDashed, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx";

export type BadgeTone = "neutral" | "accent" | "warning" | "danger" | "success";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-fg-muted",
  accent: "bg-accent-subtle text-accent",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  success: "bg-success-bg text-success",
};

const badgeBase =
  "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap";

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return <span className={cx(badgeBase, tones[tone], className)}>{children}</span>;
}

export type TopicState = "NEEDS_REINFORCEMENT" | "DEVELOPING" | "CONSISTENTLY_DEMONSTRATED";

export const TOPIC_STATE_LABELS: Record<TopicState, string> = {
  NEEDS_REINFORCEMENT: "Needs reinforcement",
  DEVELOPING: "Developing",
  CONSISTENTLY_DEMONSTRATED: "Consistently demonstrated",
};

const stateStyles: Record<TopicState, { cls: string; Icon: typeof RotateCcw }> = {
  NEEDS_REINFORCEMENT: { cls: "bg-state-reinforce-bg text-state-reinforce", Icon: RotateCcw },
  DEVELOPING: { cls: "bg-state-developing-bg text-state-developing", Icon: CircleDashed },
  CONSISTENTLY_DEMONSTRATED: {
    cls: "bg-state-demonstrated-bg text-state-demonstrated",
    Icon: CircleCheck,
  },
};

/**
 * Learning-state badge (PRD §12.2). Always the full text label plus a shape icon, so meaning never
 * depends on color. Reinforcement is amber-brown, never red: it is not a failure.
 * Unknown or missing state renders "Not enough evidence yet".
 */
export function StateBadge({
  state,
  className,
}: {
  state: TopicState | string | null | undefined;
  className?: string;
}) {
  const s = state ? stateStyles[state as TopicState] : undefined;
  if (!s) return <Badge className={className}>Not enough evidence yet</Badge>;
  const { cls, Icon } = s;
  return (
    <span data-state={state} className={cx(badgeBase, cls, className)}>
      <Icon aria-hidden="true" size={12} strokeWidth={2} />
      {TOPIC_STATE_LABELS[state as TopicState]}
    </span>
  );
}
