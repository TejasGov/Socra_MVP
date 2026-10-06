import { cx } from "./cx";

/** Small, unobtrusive marker that the deterministic mock AI provider is active. */
export function DevBadge({ className }: { className?: string }) {
  return (
    <span
      role="status"
      title="No model API key is configured. Socra replies come from the deterministic mock provider."
      className={cx(
        "inline-flex items-center rounded-sm border border-border-strong bg-warning-bg px-1.5 py-0.5 text-xs font-medium text-warning",
        className,
      )}
    >
      AI mock mode
    </span>
  );
}
