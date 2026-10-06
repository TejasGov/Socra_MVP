import { formatRelative, fullTimestamp } from "./format";

/**
 * <time> with relative-or-absolute text and the full timestamp in `title`.
 * Relative text depends on the clock, so server and client output can differ by a minute;
 * suppressHydrationWarning keeps that from raising a hydration mismatch.
 */
export function DateText({
  date,
  className,
  fallback = "None",
}: {
  date: Date | string | null | undefined;
  className?: string;
  /** Text when there is no date, e.g. "No due date" or "Not submitted". */
  fallback?: string;
}) {
  if (!date) return <span className={className}>{fallback}</span>;
  const d = typeof date === "string" ? new Date(date) : date;
  return (
    <time
      dateTime={d.toISOString()}
      title={fullTimestamp(d)}
      className={className}
      suppressHydrationWarning
    >
      {formatRelative(d)}
    </time>
  );
}
