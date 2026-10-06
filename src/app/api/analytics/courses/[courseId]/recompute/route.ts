import { requireUser } from "@/server/auth/current-user";
import { assertCan } from "@/server/auth/rbac";
import { recomputeAggregates } from "@/server/domain/analytics";
import { assertSameOrigin, json, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** POST: on-demand aggregate refresh for one course (course staff). */
export const POST = route(async (req, ctx: { params: Promise<{ courseId: string }> }) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { courseId } = await ctx.params;
  assertCan(user, "analytics:course:read", { courseId });
  return json(await recomputeAggregates(courseId));
});
