import { requireUser } from "@/server/auth/current-user";
import { completePracticeSession } from "@/server/domain/practice";
import { assertSameOrigin, json, route } from "@/server/http";

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  const user = await requireUser();
  return json(await completePracticeSession(user, id));
});
