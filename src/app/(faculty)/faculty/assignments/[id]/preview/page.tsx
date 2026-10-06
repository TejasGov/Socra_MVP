import { notFound } from "next/navigation";
import { Eye } from "lucide-react";
import { Badge, LinkButton, ModeBanner, PageHeader, Panel, bannerModeFor } from "@/components/ui";
import { Markdown } from "@/components/workspace/markdown";
import { requirePageUser } from "@/server/auth/current-user";
import { getAssignmentForStudent } from "@/server/domain/assignments/queries";
import { getAssignmentForEdit } from "@/server/domain/assignments/service";
import { LifecyclePanel } from "../../_components/lifecycle-panel";

export const metadata = { title: "Preview assignment" };
export const dynamic = "force-dynamic";

const show = (v: unknown) => (v === undefined ? "" : JSON.stringify(v));
const when = (d: Date | null) =>
  d ? d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "Not set";

/**
 * Read-only student view for staff. getAssignmentForStudent returns preview=true for non-students: no drafts, runs,
 * progress or events are read or written, so nothing here becomes student data.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser(`/faculty/assignments/${id}/preview`);
  const view = await getAssignmentForStudent(user, id);
  if (!view || !view.preview) notFound();
  const edit = await getAssignmentForEdit(user, id).catch(() => null);

  return (
    <div className="max-w-[1200px] space-y-6">
      <PageHeader
        title={view.title}
        meta={`${view.courseCode} · ${view.totalPoints} points`}
        back={{ href: `/faculty/assignments/${id}/edit`, label: "Back to editing" }}
        actions={<LinkButton href={`/faculty/assignments/${id}/edit`}>Edit assignment</LinkButton>}
      />
      <div
        role="status"
        className="border-border bg-accent-subtle text-fg flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
        data-testid="preview-banner"
      >
        <Eye size={16} aria-hidden="true" />
        <span>
          <strong className="font-semibold">Preview.</strong> This is what students see, read-only.
          Nothing here is stored as student data, and submission is disabled.
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_410px]">
        <div className="min-w-0 space-y-4">
          {view.description ? (
            <Panel>
              <div className="max-w-[68ch]">
                <Markdown>{view.description}</Markdown>
              </div>
            </Panel>
          ) : null}
          {view.learningObjectives.length > 0 ? (
            <Panel title="Learning objectives" titleAs="h2">
              <ul className="text-fg list-disc pl-5 text-sm">
                {view.learningObjectives.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {view.questions.length === 0 ? (
            <p className="text-fg-muted text-sm">There are no questions yet.</p>
          ) : null}
          {view.questions.map((q, i) => (
            <Panel
              key={q.id}
              title={`${i + 1}. ${q.title}`}
              titleAs="h2"
              meta={`${q.points} points${q.language ? ` · ${q.language.charAt(0)}${q.language.slice(1).toLowerCase()}` : ""}`}
            >
              <div className="space-y-4">
                <div className="max-w-[68ch]">
                  <Markdown>{q.prompt}</Markdown>
                </div>
                {q.choices ? (
                  <ul className="space-y-1 text-sm">
                    {q.choices.map((c) => (
                      <li key={c} className="border-border rounded-sm border px-2 py-1">
                        {c}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {q.type === "CODING" ? (
                  <div>
                    <h3 className="text-fg text-sm font-medium">Starter code</h3>
                    <pre
                      className="border-border bg-surface-2 mt-1 overflow-x-auto rounded-md border p-3 font-mono text-[13px] leading-5"
                      aria-label={`Starter code for question ${i + 1}`}
                    >
                      {q.starterCode || "(empty)"}
                    </pre>
                  </div>
                ) : (
                  <div className="border-border-strong bg-surface text-fg-subtle rounded-md border px-2.5 py-2 text-sm">
                    The student&apos;s answer box appears here.
                  </div>
                )}
                {q.publicTests.length > 0 ? (
                  <div>
                    <h3 className="text-fg text-sm font-medium">Public tests students can run</h3>
                    <ul className="mt-1 space-y-1 text-sm">
                      {q.publicTests.map((t) => (
                        <li key={t.id} className="text-fg-muted font-mono text-[13px]">
                          {t.name}:{" "}
                          {t.kind === "function"
                            ? `${t.entryPoint ?? q.entryPoint ?? "f"}(${(t.args ?? []).map(show).join(", ")}) returns ${show(t.expectedReturn)}`
                            : `input ${JSON.stringify(t.stdin ?? "")} prints ${JSON.stringify(t.expectedStdout ?? "")}`}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {q.scaffold.length > 0 ? (
                  <div>
                    <h3 className="text-fg text-sm font-medium">Stages</h3>
                    <ol className="text-fg mt-1 list-decimal pl-5 text-sm">
                      {q.scaffold.map((s) => (
                        <li key={s.order}>
                          <span className="font-medium">{s.title}.</span> {s.instructions}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            </Panel>
          ))}
        </div>

        <aside className="space-y-4" aria-label="Socra policy and settings">
          <Panel title="What Socra will do" titleAs="h2">
            <div className="space-y-3 text-sm">
              <ModeBanner mode={bannerModeFor(view.mode)}>
                {view.mode === "PROTECTED_ASSESSMENT" ? (
                  <p className="text-fg-muted">
                    Until the assignment closes{view.policy ? `, up to hint level L${view.policy.maxInterventionLevel}` : ""}.
                    Submitting does not unlock solutions.
                  </p>
                ) : null}
              </ModeBanner>
              {view.policy ? (
                <>
                  <div>
                    <h3 className="text-fg text-sm font-semibold">Available support</h3>
                    <ul className="text-fg mt-1 list-disc pl-5">
                      {view.policy.allowedBehaviors.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="text-fg text-sm font-semibold">Socra will not</h3>
                    <ul className="text-fg mt-1 list-disc pl-5">
                      {view.policy.forbiddenBehaviors.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                <p className="text-fg-muted">No policy saved yet.</p>
              )}
              <p className="text-fg-subtle text-xs">
                To try messages such as &quot;Give me the answer&quot; against this policy, use the
                test box in the Socra policy section of the editor.
              </p>
            </div>
          </Panel>
          <Panel title="Publish settings" titleAs="h2">
            <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
              <dt className="text-fg-muted">Course</dt>
              <dd>{view.courseCode}</dd>
              <dt className="text-fg-muted">Opens</dt>
              <dd>{when(view.openAt)}</dd>
              <dt className="text-fg-muted">Due</dt>
              <dd>{when(view.dueAt)}</dd>
              <dt className="text-fg-muted">Closes</dt>
              <dd>{when(view.closeAt)}</dd>
              <dt className="text-fg-muted">Attempts</dt>
              <dd>{view.attemptLimit ?? "Unlimited"}</dd>
              <dt className="text-fg-muted">Analytics</dt>
              <dd>
                <Badge tone="neutral">Aggregate only</Badge>
              </dd>
            </dl>
          </Panel>
        </aside>
      </div>

      {edit ? (
        <LifecyclePanel
          assignmentId={id}
          state={edit.meta.state}
          solutionsReleased={edit.meta.solutionsReleased}
          solutionReleaseMode={edit.input.solutionReleaseMode}
        />
      ) : null}
    </div>
  );
}
