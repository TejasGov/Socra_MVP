import { requireUser } from "@/server/auth/current-user";
import { courseUpdateSchema, updateCourse } from "@/server/domain/admin/courses";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const PATCH = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { id } = await ctx.params;
  const input = await parseJson(req, courseUpdateSchema);
  const course = await updateCourse(user, id, input);
  return json({ id: course.id });
});
