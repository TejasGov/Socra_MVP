import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";
import { reopenAssignment } from "@/server/domain/assignments/service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  reason: z.string().min(5).max(1000),
  closeAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const POST = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  const body = await parseJson(req, schema);
  const user = await requireUser();
  return json(
    await reopenAssignment(user, id, {
      reason: body.reason,
      closeAt:
        body.closeAt === undefined ? undefined : body.closeAt ? new Date(body.closeAt) : null,
    }),
  );
});
