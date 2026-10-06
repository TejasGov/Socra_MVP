import type { ReactNode } from "react";
import { cx } from "./cx";
import { formatPercent } from "./format";

/** Shape returned by analytics (contract D). `suppressed` when denominator < threshold. */
export interface MetricValue {
  numerator: number;
  denominator: number;
  value: number | null;
  suppressed: boolean;
}

/** percent: value is a 0..1 ratio (or 0..100); count: integer; decimal: one decimal place. */
export type MetricFormat = "percent" | "count" | "decimal";

function formatValue(v: MetricValue, format: MetricFormat): string {
  if (v.value === null) return "";
  if (format === "percent") {
    return formatPercent(v.value);
  }
  if (format === "decimal") return (Math.round(v.value * 10) / 10).toString();
  return Math.round(v.value).toString();
}

/**
 * Number + label + denominator line ("46 of 118 students"). When suppressed or null it shows
 * "Insufficient data" with n (and the minimum when `minN` is given), never a zero.
 * Render inside <MetricStrip> (a <dl>). `minN` should come from config.
 */
export function Metric({
  label,
  metric,
  format = "percent",
  unit,
  context,
  minN,
  className,
}: {
  label: ReactNode;
  metric: MetricValue;
  format?: MetricFormat;
  /** Noun for the denominator, e.g. "students". */
  unit?: string;
  /** Extra scope, e.g. "Recursion Lab Q4". */
  context?: ReactNode;
  minN?: number;
  className?: string;
}) {
  const insufficient = metric.suppressed || metric.value === null;
  return (
    <div
      data-testid="analytics-metric"
      data-suppressed={insufficient ? "true" : "false"}
      className={cx("min-w-0", className)}
    >
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5">
        {insufficient ? (
          <>
            {metric.denominator === 0 ? (
              <span className="block text-base font-medium text-fg-muted">No responses yet</span>
            ) : (
              <>
                <span className="block text-base font-medium text-fg-muted">Insufficient data</span>
                <span className="block text-xs text-fg-subtle tabular-nums">
                  n = {metric.denominator}
                  {minN !== undefined ? `, minimum ${minN}` : ""}
                </span>
              </>
            )}
          </>
        ) : (
          <>
            <span className="block text-xl font-semibold text-fg tabular-nums">
              {formatValue(metric, format)}
            </span>
            <span className="block text-xs text-fg-subtle tabular-nums">
              {format === "percent"
                ? `${metric.numerator} of ${metric.denominator}${unit ? ` ${unit}` : ""}`
                : `n = ${metric.denominator}${unit ? ` ${unit}` : ""}`}
              {context ? <> · {context}</> : null}
            </span>
          </>
        )}
      </dd>
    </div>
  );
}

/** A compact row of metrics (a definition list), not bordered tiles. */
export function MetricStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cx("flex flex-wrap gap-x-10 gap-y-4 border-y border-border py-3", className)}>
      {children}
    </dl>
  );
}
