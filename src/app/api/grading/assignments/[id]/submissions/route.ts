import { requireUser } from "@/server/auth/current-user";
import { json, route } from "@/server/http";
import { listSubmissionsForAssignment } from "@/server/domain/grading/service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  return json(await listSubmissionsForAssignment(user, id));
});
