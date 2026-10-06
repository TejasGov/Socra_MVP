/** Small fixed dev indicator shown whenever the AI gateway is using the deterministic mock provider. */
export function MockModeIndicator() {
  return (
    <div
      role="status"
      aria-label="AI mock mode is active"
      className="border-border-strong bg-warning-bg text-warning fixed right-3 bottom-3 z-50 rounded-sm border px-2 py-1 text-xs font-medium"
    >
      AI mock mode
    </div>
  );
}
