import { requireUser } from "@/server/auth/current-user";
import { courseInputSchema, createCourse, listCourses } from "@/server/domain/admin/courses";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await requireUser();
  return json({ courses: await listCourses(user) });
});

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const input = await parseJson(req, courseInputSchema);
  const course = await createCourse(user, input);
  return json({ id: course.id }, { status: 201 });
});
