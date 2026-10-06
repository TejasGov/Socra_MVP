import { requireUser } from "@/server/auth/current-user";
import {
  changeParticipantCondition,
  conditionChangeSchema,
} from "@/server/domain/research/participants";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** Only research:condition:manage (RESEARCH_ADMIN). Students have no route to change their own condition. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { id } = await ctx.params;
  const input = await parseJson(req, conditionChangeSchema);
  return json(await changeParticipantCondition(user, id, input));
});
