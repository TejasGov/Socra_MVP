import { requireUser } from "@/server/auth/current-user";
import { getQuestionDrilldown } from "@/server/domain/analytics";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET question drilldown (aggregates + funnel). Never includes conversation text. */
export const GET = route(async (_req, ctx: { params: Promise<{ questionId: string }> }) => {
  const user = await requireUser();
  const { questionId } = await ctx.params;
  return json(await getQuestionDrilldown(user, questionId));
});
