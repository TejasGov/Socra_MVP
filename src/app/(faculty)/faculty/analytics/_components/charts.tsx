import Link from "next/link";
import type { ReactNode } from "react";
import type { FunnelStep, MetricValue } from "@/server/domain/analytics/types";
import { formatPercent } from "@/components/ui/format";

/**
 * Faculty analytics visuals (guardrails §2.4 / §5.4–5.5): one hue, direct value labels, denominators always visible,
 * suppressed rows never drawn as bars (grouped as "N with too few responses").
 */

export function formatPct(m: MetricValue): string {
  return formatPercent(m.value);
}

/** Table cell / inline metric: "39%  46/118" or "Insufficient data (n = 3)". */
export function MetricText({ metric, unit }: { metric: MetricValue; unit?: string }) {
  const insufficient = metric.suppressed || metric.value === null;
  return (
    <span
      data-testid="analytics-metric"
      data-suppressed={insufficient ? "true" : "false"}
      className="tabular-nums"
    >
      {insufficient ? (
        <span className="text-fg-muted">
          {metric.denominator === 0 ? "No responses yet" : <>Insufficient data{" "}<span className="text-fg-subtle text-xs">(n = {metric.denominator})</span></>}
        </span>
      ) : (
        <>
          <span className="text-fg font-medium">{formatPct(metric)}</span>{" "}
          <span className="text-fg-subtle text-xs">
            {metric.numerator}/{metric.denominator}
            {unit ? ` ${unit}` : ""}
          </span>
        </>
      )}
    </span>
  );
}

/** Average level metric (intervention depth): "2.1 avg, max 5  n = 40". */
export function DepthText({ metric }: { metric: MetricValue & { max: number | null } }) {
  const insufficient = metric.suppressed || metric.value === null;
  return (
    <span
      data-testid="analytics-metric"
      data-suppressed={insufficient ? "true" : "false"}
      className="tabular-nums"
    >
      {insufficient ? (
        <span className="text-fg-muted">
          {metric.denominator === 0 ? "No responses yet" : <>Insufficient data{" "}<span className="text-fg-subtle text-xs">(n = {metric.denominator})</span></>}
        </span>
      ) : (
        <>
          <span className="text-fg font-medium">L{(metric.value ?? 0).toFixed(1)}</span>{" "}
          <span className="text-fg-subtle text-xs">
            max L{metric.max ?? 0} · n = {metric.denominator}
          </span>
        </>
      )}
    </span>
  );
}

export interface BarRow {
  key: string;
  label: ReactNode;
  href?: string;
  metric: MetricValue;
  testId?: string;
}

/** Ranked horizontal bars with the percentage and n/d written next to each bar. */
export function BarList({
  rows,
  unit,
  suppressedNoun,
  highlightFirst = true,
}: {
  rows: BarRow[];
  unit: string;
  suppressedNoun: string;
  highlightFirst?: boolean;
}) {
  const shown = rows.filter((r) => !r.metric.suppressed && r.metric.value !== null);
  const hidden = rows.length - shown.length;
  return (
    <div>
      <ul className="space-y-2.5">
        {shown.map((r, i) => {
          const width = Math.max(1, Math.round((r.metric.value ?? 0) * 100));
          return (
            <li key={r.key} data-testid="analytics-metric" data-suppressed="false">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                {r.href ? (
                  <Link
                    href={r.href}
                    data-testid={r.testId}
                    className="text-fg min-w-0 truncate hover:underline"
                  >
                    {r.label}
                  </Link>
                ) : (
                  <span className="text-fg min-w-0 truncate">{r.label}</span>
                )}
                <span className="shrink-0 tabular-nums">
                  <span className="text-fg font-medium">{formatPct(r.metric)}</span>{" "}
                  <span className="text-fg-subtle text-xs">
                    {r.metric.numerator} of {r.metric.denominator} {unit}
                  </span>
                </span>
              </div>
              <div className="bg-surface-2 mt-1 h-2 w-full rounded-sm" aria-hidden="true">
                <div
                  className={
                    highlightFirst && i === 0
                      ? "bg-chart-1 h-2 rounded-sm"
                      : "bg-chart-2 h-2 rounded-sm"
                  }
                  style={{ width: `${width}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 && hidden === 0 ? (
        <p className="text-fg-muted text-sm">No data yet.</p>
      ) : null}
      {hidden > 0 ? (
        <p className="text-fg-subtle mt-3 text-xs">
          {hidden} {suppressedNoun}
          {hidden === 1 ? "" : "s"} with too few responses (fewer than the minimum group size).
        </p>
      ) : null}
    </div>
  );
}

/** Weekly vertical bars as accessible SVG. Values are shares; each bar labelled with % and n/d. */
export function WeeklyBars({
  weeks,
  title,
}: {
  weeks: { week: string; weekStart: string; metric: MetricValue; sessions: number }[];
  title: string;
}) {
  const W = 520;
  const H = 180;
  const padL = 34;
  const padB = 34;
  const padT = 22;
  const plotH = H - padB - padT;
  const slot = (W - padL) / Math.max(1, weeks.length);
  const barW = Math.min(36, slot * 0.6);
  const y = (v: number) => padT + plotH * (1 - v);
  const label = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const desc = weeks
    .map((w) =>
      w.metric.suppressed || w.metric.value === null
        ? `Week of ${label(w.weekStart)}: insufficient data (n = ${w.metric.denominator})`
        : `Week of ${label(w.weekStart)}: ${formatPct(w.metric)}, ${w.metric.numerator} of ${w.metric.denominator} active students, ${w.sessions} sessions`,
    )
    .join(". ");
  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${title}. ${desc}`}
        className="h-auto w-full"
      >
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="fill-fg-subtle text-[11px]">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const cx = padL + slot * i + slot / 2;
          const ok = !w.metric.suppressed && w.metric.value !== null;
          const v = ok ? (w.metric.value ?? 0) : 0;
          return (
            <g key={w.week}>
              {ok ? (
                <>
                  <rect
                    x={cx - barW / 2}
                    y={y(v)}
                    width={barW}
                    height={Math.max(1, plotH * v)}
                    className="fill-chart-1"
                  />
                  <text
                    x={cx}
                    y={y(v) - 5}
                    textAnchor="middle"
                    className="fill-fg text-xs tabular-nums"
                  >
                    {formatPct(w.metric)}
                  </text>
                </>
              ) : (
                <text x={cx} y={y(0) - 5} textAnchor="middle" className="fill-fg-subtle text-xs">
                  n={w.metric.denominator}
                </text>
              )}
              <text x={cx} y={H - 18} textAnchor="middle" className="fill-fg-muted text-xs">
                {label(w.weekStart)}
              </text>
              <title>
                {ok ? `${w.metric.numerator} of ${w.metric.denominator} active students` : `Too few active students (n = ${w.metric.denominator})`}
              </title>
            </g>
          );
        })}
      </svg>
      <figcaption className="text-fg-subtle mt-1 text-xs">
        Bars show students who started a Socra session that week, out of students active in the
        course that week (week starting Monday, UTC). Weeks with fewer active students than the
        minimum group size show no bar.
      </figcaption>
    </figure>
  );
}

/** Interaction funnel as labelled horizontal bars relative to the first step. */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const base = steps[0]?.count ?? 0;
  if (steps.length === 0 || base === 0) {
    return <p className="text-fg-muted text-sm">No recorded activity on this question yet.</p>;
  }
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => {
        const share = base > 0 ? s.count / base : 0;
        return (
          <li key={s.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-fg">{s.label}</span>
              <span className="shrink-0 tabular-nums">
                <span className="text-fg font-medium">{s.count}</span>{" "}
                <span className="text-fg-subtle text-xs">
                  {i === 0 ? "students" : `of ${base} students`}
                </span>
              </span>
            </div>
            <div className="bg-surface-2 mt-1 h-2 w-full rounded-sm" aria-hidden="true">
              <div
                className="bg-chart-1 h-2 rounded-sm"
                style={{ width: `${Math.max(1, Math.round(share * 100))}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** The quiet, persistent privacy line for faculty analytics views. */
export function AnonymousScope() {
  return (
    <p className="text-fg-subtle text-xs">
      Anonymous, class-level view. No student names and no Socra conversation text appear in
      analytics.
    </p>
  );
}
