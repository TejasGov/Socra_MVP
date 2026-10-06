"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Select } from "@/components/ui";

/** Tri-state override control: inherit (no row), on, or off. Saves on change and is audited server-side. */
export function FlagSelect({
  flagKey,
  courseId,
  value,
  label,
}: {
  flagKey: string;
  courseId?: string;
  value: boolean | null;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <Select
        aria-label={label}
        data-testid={`flag-${flagKey}-${courseId ?? "env"}`}
        className="h-7 w-28 text-xs"
        defaultValue={value === null ? "inherit" : String(value)}
        disabled={busy}
        onChange={async (e) => {
          const v = e.target.value;
          setBusy(true);
          setError(null);
          try {
            const res = await fetch("/api/admin/flags", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                key: flagKey,
                courseId,
                enabled: v === "inherit" ? null : v === "true",
              }),
            });
            if (!res.ok) {
              const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
              setError(data.error?.message ?? "Failed");
              return;
            }
            router.refresh();
          } catch {
            setError("Failed");
          } finally {
            setBusy(false);
          }
        }}
      >
        <option value="inherit">Inherit</option>
        <option value="true">On</option>
        <option value="false">Off</option>
      </Select>
      {error ? (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
