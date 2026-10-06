import { requireUser } from "@/server/auth/current-user";
import { getCourseOverview } from "@/server/domain/analytics";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET course overview metrics (aggregates only). */
export const GET = route(async (_req, ctx: { params: Promise<{ courseId: string }> }) => {
  const user = await requireUser();
  const { courseId } = await ctx.params;
  return json(await getCourseOverview(user, courseId));
});
