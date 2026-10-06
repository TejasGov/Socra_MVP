import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { assertSameOrigin, json, route } from "@/server/http";
import { publishAssignment } from "@/server/domain/assignments/service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  const raw: unknown = await req.json().catch(() => ({}));
  const body = z.object({ changeNote: z.string().max(500).optional() }).parse(raw ?? {});
  const user = await requireUser();
  return json(await publishAssignment(user, id, body));
});
