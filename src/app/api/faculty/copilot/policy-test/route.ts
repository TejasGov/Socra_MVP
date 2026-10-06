import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { testSocraPolicy } from "@/server/domain/authoring-ai";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  assignmentId: z.string().min(1),
  message: z.string().trim().min(1).max(4000),
  code: z.string().max(60_000).nullable().optional(),
  questionId: z.string().nullable().optional(),
});

/** POST -> { reply, interventionLevel, policyOutcome } preview of protected Socra (not stored as student data). */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const input = await parseJson(req, schema);
  return json(await testSocraPolicy(user, input));
});
