import { requireUser } from "@/server/auth/current-user";
import { applyRosterImport, getRosterImport } from "@/server/domain/admin/roster";
import { assertSameOrigin, json, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, ctx: { params: Promise<{ id: string }> }) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  return json(await getRosterImport(user, id));
});

/** POST applies a validated import in one transaction. */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { id } = await ctx.params;
  return json(await applyRosterImport(user, id));
});
