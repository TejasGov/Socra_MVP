import { requireUser } from "@/server/auth/current-user";
import {
  adminAssignmentActionSchema,
  adminSetAssignmentState,
} from "@/server/domain/admin/assignments";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** POST { action: "close" | "reopen", reason, closeAt? } */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { id } = await ctx.params;
  const input = await parseJson(req, adminAssignmentActionSchema);
  return json(await adminSetAssignmentState(user, id, input));
});
