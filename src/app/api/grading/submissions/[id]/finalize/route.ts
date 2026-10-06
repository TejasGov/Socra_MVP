import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";
import { finalizeGrade } from "@/server/domain/grading/service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  const body = await parseJson(req, z.looseObject({}));
  const user = await requireUser();
  return json(await finalizeGrade(user, id, body));
});
