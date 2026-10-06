import { PageHeader, EmptyState } from "@/components/ui";
import { requirePageUser } from "@/server/auth/current-user";
import { listAuthoringCourses } from "@/server/domain/assignments/authoring-options";
import { AssignmentForm } from "../_components/assignment-form";

export const metadata = { title: "Create assignment" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requirePageUser("/faculty/assignments/new");
  const courses = await listAuthoringCourses(user);
  return (
    <div className="max-w-[1200px]">
      <PageHeader
        title="Create assignment"
        meta="Everything here is a draft until you publish."
        back={{ href: "/faculty/assignments", label: "Assignments" }}
      />
      {courses.length === 0 ? (
        <EmptyState>
          You are not an instructor in any course, so you cannot create assignments.
        </EmptyState>
      ) : (
        <AssignmentForm courses={courses} />
      )}
    </div>
  );
}
