import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { addCourseStaff, removeCourseStaff, staffInputSchema } from "@/server/domain/admin/courses";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { id } = await ctx.params;
  const input = await parseJson(req, staffInputSchema);
  return json(await addCourseStaff(user, id, input), { status: 201 });
});

export const DELETE = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { id } = await ctx.params;
  const { userId } = await parseJson(req, z.object({ userId: z.string().min(1) }));
  return json(await removeCourseStaff(user, id, userId));
});
