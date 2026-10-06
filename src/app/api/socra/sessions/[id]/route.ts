import { requireUser } from "@/server/auth/current-user";
import { getOwnSocraSession } from "@/server/domain/socra";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET -> the caller's own session and messages (404 for anyone else). */
export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  return json(await getOwnSocraSession(user, id));
});
