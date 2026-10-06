/** Assistance intervention ladder (PRD §10.7). Labels mirror src/server/ai/types.ts INTERVENTION_LEVEL_LABELS. */
export const GUIDANCE_LABELS = [
  "Orientation",
  "Socratic question",
  "Conceptual hint",
  "Pointing to the problem area",
  "Related example or course reference",
  "Strong directional hint",
  "Referred to TA or instructor",
] as const;

export function guidanceLabel(level: number): string {
  return GUIDANCE_LABELS[Math.max(0, Math.min(6, Math.round(level)))] ?? "";
}

/**
 * Small persistent meter: text label plus 7 segments (L0–L6). Text carries the meaning; segments are a visual aid.
 */
export function GuidanceDepth({ current, max }: { current: number | null; max: number | null }) {
  const reached = max ?? -1;
  return (
    <div className="text-fg-muted flex items-center gap-2 text-xs">
      <span>
        Guidance depth:{" "}
        {current === null ? (
          <span className="text-fg-subtle">none yet</span>
        ) : (
          <span className="text-fg">
            {current} of 6, {guidanceLabel(current)}
          </span>
        )}
      </span>
      <span aria-hidden="true" className="flex gap-0.5">
        {GUIDANCE_LABELS.map((_, i) => (
          <span
            key={i}
            className={
              i <= reached
                ? "bg-accent h-1.5 w-2.5 rounded-sm"
                : "bg-border-strong h-1.5 w-2.5 rounded-sm"
            }
          />
        ))}
      </span>
    </div>
  );
}
