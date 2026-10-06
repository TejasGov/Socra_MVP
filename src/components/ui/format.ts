/**
 * Date display per guardrails §5.2: relative under 7 days ("8 min ago", "in 2 days"),
 * absolute after ("Sep 7"). Pair with `fullTimestamp` in a `title` attribute (see <DateText>).
 */
export function formatRelative(date: Date | string | null | undefined, now = new Date()): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = d.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const future = diffMs > 0;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  const wrap = (s: string) => (future ? `in ${s}` : `${s} ago`);
  if (abs < min) return future ? "in under a minute" : "just now";
  if (abs < hour) return wrap(`${Math.round(abs / min)} min`);
  if (abs < day) {
    const h = Math.round(abs / hour);
    return wrap(`${h} hr`);
  }
  if (abs < 7 * day) {
    const n = Math.round(abs / day);
    return wrap(`${n} day${n === 1 ? "" : "s"}`);
  }
  return formatShortDate(d, now);
}

/** "Sep 7", or "Sep 7, 2025" when not the current year. */
export function formatShortDate(date: Date | string, now = new Date()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** "Sep 7, 2026, 11:59 PM" for title attributes. */
export function fullTimestamp(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "Due Oct 9, 11:59 PM" style: absolute date and time. */
export function formatDue(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Whole-percent formatter shared by every faculty analytics surface. Accepts a 0..1 ratio (or 0..100). */
export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}
