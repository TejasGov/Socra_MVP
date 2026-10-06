import { redirect } from "next/navigation";

/** The assignment list lives on the course page. */
export default async function AssignmentsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  redirect(`/courses/${courseId}#assignments`);
}
