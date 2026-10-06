"use client";

import { useState } from "react";
import { Button, ErrorState } from "@/components/ui";

/**
 * Calls POST /api/faculty/brief (Agent A). The model only receives the computed metrics shown on this page, so the
 * result is labelled as a summary of those numbers.
 */
export function BriefButton({ courseId }: { courseId: string }) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "done"; text: string; at: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function generate() {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/faculty/brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      const body = (await res.json().catch(() => null)) as {
        text?: string;
        brief?: { text?: string };
        error?: { message?: string };
      } | null;
      const text = body?.text ?? body?.brief?.text;
      if (!res.ok || !text) {
        setState({
          kind: "error",
          message:
            body?.error?.message ??
            "The brief could not be generated. The numbers above are unaffected.",
        });
        return;
      }
      setState({
        kind: "done",
        text,
        at: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      });
    } catch {
      setState({ kind: "error", message: "Network error. Check your connection and try again." });
    }
  }

  return (
    <div className="space-y-3">
      <Button
        variant="secondary"
        size="sm"
        onClick={generate}
        disabled={state.kind === "loading"}
        data-testid="generate-brief"
      >
        {state.kind === "loading" ? "Generating brief…" : "Generate weekly brief"}
      </Button>
      {state.kind === "done" ? (
        <div className="space-y-1" aria-live="polite">
          <p className="text-fg-subtle text-xs">
            Summary of the numbers on this page, written at {state.at}. It does not add new
            statistics.
          </p>
          <div className="text-fg text-sm whitespace-pre-wrap">{state.text}</div>
        </div>
      ) : null}
      {state.kind === "error" ? (
        <ErrorState title="Brief not generated">{state.message}</ErrorState>
      ) : null}
    </div>
  );
}
