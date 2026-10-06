import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { createSocraSession } from "@/server/domain/socra";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    assignmentId: z.string().min(1).optional().nullable(),
    questionId: z.string().min(1).optional().nullable(),
    practiceSessionId: z.string().min(1).optional().nullable(),
    mode: z.string().optional().nullable(),
  })
  .refine((v) => Boolean(v.assignmentId || v.practiceSessionId), {
    message: "assignmentId or practiceSessionId is required",
  });

/** POST { assignmentId?, questionId?, practiceSessionId?, mode? } -> { sessionId, mode, policySummary } */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const input = await parseJson(req, schema);
  const res = await createSocraSession(user, input);
  return json(
    {
      sessionId: res.sessionId,
      mode: res.mode,
      policySummary: res.policySummary,
      maxInterventionLevel: res.maxInterventionLevel,
    },
    { status: res.created ? 201 : 200 },
  );
});
