import type { ReactNode } from "react";
import { cx } from "./cx";

export interface PanelProps {
  title?: ReactNode;
  titleAs?: "h2" | "h3";
  actions?: ReactNode;
  meta?: ReactNode;
  /** Pad the body (default true). Set false when the body is a full-bleed list. */
  padded?: boolean;
  className?: string;
  id?: string;
  children: ReactNode;
}

/**
 * Flat panel: 1px border, no shadow, rounded-lg. Use sparingly and never nest a Panel in a Panel.
 * Optional title row with right-aligned actions.
 */
export function Panel({
  title,
  titleAs: TitleTag = "h2",
  actions,
  meta,
  padded = true,
  className,
  id,
  children,
}: PanelProps) {
  return (
    <section id={id} className={cx("rounded-lg border border-border bg-surface", className)}>
      {title || actions ? (
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title ? (
              <TitleTag className="text-base font-semibold text-fg">{title}</TitleTag>
            ) : null}
            {meta ? <p className="text-xs text-fg-subtle">{meta}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={padded ? "p-4" : undefined}>{children}</div>
    </section>
  );
}

/** Alias where "card" is the natural word. Same flat surface. */
export const Card = Panel;

/** Section heading (h2) with optional meta and actions, grouping content without a container. */
export function Section({
  title,
  actions,
  meta,
  className,
  id,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
  /** id for the heading; the section is labelled by it. */
  id?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cx("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-base font-semibold text-fg">
            {title}
          </h2>
          {meta ? <p className="text-xs text-fg-subtle">{meta}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
