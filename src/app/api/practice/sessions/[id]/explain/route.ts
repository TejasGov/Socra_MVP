import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { requestExplanation } from "@/server/domain/practice";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  const { itemId } = await parseJson(req, z.object({ itemId: z.string().min(1) }));
  const user = await requireUser();
  return json(await requestExplanation(user, { sessionId: id, itemId }));
});

// Vercel function limit: long model generations need more than the default.
export const maxDuration = 60;
