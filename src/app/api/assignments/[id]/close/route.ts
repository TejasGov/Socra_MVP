import { requireUser } from "@/server/auth/current-user";
import { assertSameOrigin, json, route } from "@/server/http";
import { closeAssignment } from "@/server/domain/assignments/service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  const user = await requireUser();
  return json(await closeAssignment(user, id));
});
