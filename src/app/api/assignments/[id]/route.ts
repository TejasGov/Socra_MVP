import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";
import { getAssignmentForEdit, updateAssignment } from "@/server/domain/assignments/service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (_req, ctx) => {
  const { id } = await ctx.params;
  const user = await requireUser();
  return json(await getAssignmentForEdit(user, id));
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  const body = await parseJson(req, z.looseObject({}));
  const user = await requireUser();
  return json(await updateAssignment(user, id, body));
});
