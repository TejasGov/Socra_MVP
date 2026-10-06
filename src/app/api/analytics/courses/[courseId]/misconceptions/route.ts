import { requireUser } from "@/server/auth/current-user";
import { getMisconceptionPatterns } from "@/server/domain/analytics";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET reviewed misconception prevalence for a course. */
export const GET = route(async (_req, ctx: { params: Promise<{ courseId: string }> }) => {
  const user = await requireUser();
  const { courseId } = await ctx.params;
  return json({ misconceptions: await getMisconceptionPatterns(user, courseId) });
});
