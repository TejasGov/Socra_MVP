"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  ErrorState,
  Field,
  LoadingState,
  Panel,
  Textarea,
} from "@/components/ui";
import type { PublishReview } from "@/server/domain/assignments/service";

type Action = "publish" | "close" | "release-solutions" | "reopen" | "archive";

const STATE_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  PUBLISHED_PROTECTED: "Published",
  CLOSED: "Closed",
  ARCHIVED: "Archived",
};

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })
    : "Not set";

export function LifecyclePanel({
  assignmentId,
  state,
  solutionsReleased,
  solutionReleaseMode,
}: {
  assignmentId: string;
  state: string;
  solutionsReleased: boolean;
  solutionReleaseMode: "NEVER" | "ON_CLOSE" | "MANUAL";
}) {
  const router = useRouter();
  const editable = state === "DRAFT" || state === "SCHEDULED";
  const [review, setReview] = useState<PublishReview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editable) return;
    let alive = true;
    fetch(`/api/assignments/${assignmentId}/publish-review`)
      .then(async (r) => {
        const b = (await r.json()) as PublishReview & { error?: { message?: string } };
        if (!r.ok) throw new Error(b.error?.message ?? "Could not load the review");
        if (alive) setReview(b);
      })
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, [assignmentId, editable, state]);

  async function run(action: Action) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reopen" ? { reason } : {}),
      });
      const b = (await res.json().catch(() => ({}))) as {
        error?: { message?: string; details?: Array<{ message: string }> };
      };
      if (!res.ok) {
        const extra = Array.isArray(b.error?.details)
          ? ` ${b.error!.details!.map((d) => d.message).join(" ")}`
          : "";
        throw new Error(`${b.error?.message ?? "The action failed"}.${extra}`);
      }
      setConfirm(null);
      setReason("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rows: Array<[string, string]> = review
    ? [
        ["Audience", review.audience],
        [
          "Opens",
          review.willSchedule
            ? `${fmt(review.openAt)} (scheduled)`
            : review.openAt
              ? fmt(review.openAt)
              : "When published",
        ],
        ["Due", fmt(review.dueAt)],
        ["Closes", fmt(review.closeAt)],
        ["Attempts", review.attempts],
        [
          "Total points",
          `${review.totalPoints} across ${review.questionCount} question${review.questionCount === 1 ? "" : "s"}`,
        ],
        ["Protected mode", review.protectedMode],
        ["Grading", review.grading],
        ["Analytics", review.analyticsMode],
        ["Solution release", review.solutionRelease],
      ]
    : [];

  return (
    <Panel
      title="Publish and lifecycle"
      id="lifecycle"
      actions={
        <Badge tone={state === "PUBLISHED_PROTECTED" ? "success" : "neutral"}>
          {STATE_LABEL[state] ?? state}
        </Badge>
      }
    >
      <div className="space-y-4">
        {editable ? (
          <>
            {loadError ? (
              <ErrorState title="Could not load the publish review">{loadError}</ErrorState>
            ) : null}
            {!review && !loadError ? (
              <LoadingState label="Loading publish review" lines={4} />
            ) : null}
            {review ? (
              <>
                <dl
                  className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[160px_1fr]"
                  data-testid="publish-review"
                >
                  {rows.map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-fg-muted">{k}</dt>
                      <dd className="text-fg">{v}</dd>
                    </div>
                  ))}
                </dl>
                {review.issues.length > 0 ? (
                  <ul className="space-y-1 text-sm" aria-label="Publish checks">
                    {review.issues.map((i, k) => (
                      <li key={k} className="flex gap-2">
                        <Badge tone={i.severity === "error" ? "danger" : "warning"}>
                          {i.severity === "error" ? "Fix" : "Check"}
                        </Badge>
                        <span className="text-fg">{i.message}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="primary"
                    size="lg"
                    disabled={!review.canPublish}
                    onClick={() => setConfirm("publish")}
                    data-testid="publish-button"
                  >
                    {review.willSchedule ? "Schedule assignment" : "Publish assignment"}
                  </Button>
                  <p className="text-fg-muted text-sm">
                    {review.canPublish
                      ? "Publishing enables aggregate analytics only. Save your changes first."
                      : "Fix the listed problems and save to enable publishing."}
                  </p>
                </div>
              </>
            ) : null}
          </>
        ) : null}

        {state === "PUBLISHED_PROTECTED" ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              size="lg"
              onClick={() => setConfirm("close")}
              data-testid="close-assignment"
            >
              Close assignment
            </Button>
            <p className="text-fg-muted text-sm">
              Closing stops new submissions. Students stay in protected mode until solutions are
              released.
            </p>
          </div>
        ) : null}

        {state === "CLOSED" ? (
          <div className="space-y-3">
            <p className="text-fg-muted text-sm" data-testid="solutions-status">
              {solutionsReleased
                ? "Solutions are released. Students are in review mode."
                : solutionReleaseMode === "NEVER"
                  ? "Solutions are set to never release."
                  : "Solutions are not released. Students remain in protected mode."}
            </p>
            <div className="flex flex-wrap gap-2">
              {!solutionsReleased && solutionReleaseMode !== "NEVER" ? (
                <Button
                  variant="primary"
                  onClick={() => setConfirm("release-solutions")}
                  data-testid="release-solutions"
                >
                  Release solutions
                </Button>
              ) : null}
              <Button onClick={() => setConfirm("reopen")} data-testid="reopen-assignment">
                Reopen assignment
              </Button>
              <Button onClick={() => setConfirm("archive")}>Archive assignment</Button>
            </div>
          </div>
        ) : null}

        {state === "ARCHIVED" ? (
          <p className="text-fg-muted text-sm">This assignment is archived.</p>
        ) : null}
        {error ? <ErrorState title="That did not go through">{error}</ErrorState> : null}
      </div>

      <Dialog
        open={confirm === "publish"}
        onClose={() => setConfirm(null)}
        title={review?.willSchedule ? "Schedule this assignment?" : "Publish this assignment?"}
        description="Publishing freezes questions, tests and the Socra policy in a version snapshot. Students in the course can then see it."
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              loadingLabel="Publishing"
              onClick={() => void run("publish")}
              data-testid="publish-confirm"
            >
              {review?.willSchedule ? "Schedule assignment" : "Publish assignment"}
            </Button>
          </>
        }
      >
        {review ? (
          <p className="text-fg-muted text-sm">
            {review.audience}. {review.attempts}. {review.solutionRelease}.
          </p>
        ) : null}
      </Dialog>
      <Dialog
        open={confirm === "close"}
        onClose={() => setConfirm(null)}
        title="Close this assignment?"
        description="Students can no longer submit. This is recorded in the audit log."
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              loadingLabel="Closing"
              onClick={() => void run("close")}
              data-testid="close-confirm"
            >
              Close assignment
            </Button>
          </>
        }
      />
      <Dialog
        open={confirm === "release-solutions"}
        onClose={() => setConfirm(null)}
        title="Release solutions?"
        description="Students move to review mode, and Socra may explain complete solutions. This is recorded in the audit log."
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              loadingLabel="Releasing"
              onClick={() => void run("release-solutions")}
              data-testid="release-confirm"
            >
              Release solutions
            </Button>
          </>
        }
      />
      <Dialog
        open={confirm === "reopen"}
        onClose={() => setConfirm(null)}
        title="Reopen this assignment?"
        description="Students can submit again and return to protected mode. Any solution release is withdrawn. You must give a reason; it is recorded in the audit log."
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={reason.trim().length < 5}
              loading={busy}
              loadingLabel="Reopening"
              onClick={() => void run("reopen")}
              data-testid="reopen-confirm"
            >
              Reopen assignment
            </Button>
          </>
        }
      >
        <Field id="reopen-reason" label="Reason" required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
      <Dialog
        open={confirm === "archive"}
        onClose={() => setConfirm(null)}
        title="Archive this assignment?"
        description="Archived assignments are hidden from students and cannot be edited."
        footer={
          <>
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              loadingLabel="Archiving"
              onClick={() => void run("archive")}
            >
              Archive assignment
            </Button>
          </>
        }
      />
    </Panel>
  );
}
