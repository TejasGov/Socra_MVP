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
 * Small persistent meter for protected assignments: text plus (cap + 1) segments (L0 to the
 * assignment's cap). Both the text and the segments show the DEEPEST level reached, so they cannot
 * disagree. Text carries the meaning; segments are a visual aid.
 */
export function GuidanceDepth({ deepest, cap }: { deepest: number | null; cap: number }) {
  const top = Math.max(0, Math.min(6, Math.round(cap)));
  const reached = deepest === null ? -1 : Math.min(deepest, top);
  const atCap = deepest !== null && deepest >= top;
  return (
    <div className="text-fg-muted text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          Deepest level reached:{" "}
          {deepest === null ? (
            <span className="text-fg-subtle">none yet (up to {top} on this assignment)</span>
          ) : (
            <span className="text-fg">
              Level {reached} of {top}, {guidanceLabel(reached)}
            </span>
          )}
        </span>
        <span aria-hidden="true" className="flex gap-0.5">
          {Array.from({ length: top + 1 }, (_, i) => (
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
      {atCap ? <p className="text-fg mt-1">Next: ask your TA or instructor.</p> : null}
    </div>
  );
}
