import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";
import { requestAiSuggestion } from "@/server/domain/grading/service";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, ctx) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  const { questionId } = await parseJson(req, z.object({ questionId: z.string().min(1) }));
  const user = await requireUser();
  return json(await requestAiSuggestion(user, id, questionId));
});

// Vercel function limit: long model generations need more than the default.
export const maxDuration = 120;
