import { requireUser } from "@/server/auth/current-user";
import { getTopicDrilldown } from "@/server/domain/analytics";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx: { params: Promise<{ topicId: string }> }) => {
  const user = await requireUser();
  const { topicId } = await ctx.params;
  return json(await getTopicDrilldown(user, topicId));
});
