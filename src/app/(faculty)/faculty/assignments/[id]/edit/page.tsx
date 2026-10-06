import { notFound } from "next/navigation";
import { LinkButton, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { AuthError } from "@/server/auth/rbac";
import { listAuthoringCourses } from "@/server/domain/assignments/authoring-options";
import { getAssignmentForEdit, syncAssignmentState } from "@/server/domain/assignments/service";
import { HttpError } from "@/server/http";
import { AssignmentForm } from "../../_components/assignment-form";
import { LifecyclePanel } from "../../_components/lifecycle-panel";

export const metadata = { title: "Edit assignment" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePageUser(`/faculty/assignments/${id}/edit`);
  let model;
  try {
    await syncAssignmentState(id);
    model = await getAssignmentForEdit(user, id);
  } catch (e) {
    if (e instanceof HttpError || e instanceof AuthError) notFound();
    throw e;
  }
  const courses = (await listAuthoringCourses(user)).filter((c) => c.id === model.meta.courseId);
  if (courses.length === 0) notFound();
  const locked = model.meta.state !== "DRAFT" && model.meta.state !== "SCHEDULED";
  return (
    <div className="max-w-[1200px] space-y-6">
      <PageHeader
        title={model.input.title || "Untitled assignment"}
        meta={`${courses[0]!.code}${model.meta.currentVersion ? ` · version ${model.meta.currentVersion}` : ""}${model.meta.aiGenerated ? " · started from a copilot draft" : ""}`}
        back={{ href: "/faculty/assignments", label: "Assignments" }}
        actions={
          <>
            <LinkButton href={`/faculty/assignments/${id}/preview`} data-testid="preview-link">
              Preview as student
            </LinkButton>
            {model.meta.state !== "DRAFT" ? (
              <LinkButton href={`/faculty/assignments/${id}/submissions`}>Submissions</LinkButton>
            ) : null}
          </>
        }
      />
      <LifecyclePanel
        assignmentId={id}
        state={model.meta.state}
        solutionsReleased={model.meta.solutionsReleased}
        solutionReleaseMode={model.input.solutionReleaseMode}
      />
      <AssignmentForm courses={courses} initial={model.input} assignmentId={id} locked={locked} />
    </div>
  );
}
