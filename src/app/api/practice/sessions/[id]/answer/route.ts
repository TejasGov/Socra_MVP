import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { HttpError } from "@/server/http";
import { submitPracticeAnswer, submitSelfAssessment } from "@/server/domain/practice";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

const body = z.object({
  itemId: z.string().min(1).optional(),
  answer: z.string().max(10_000).optional(),
  attemptId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
  /** Self-assessment of an ungraded free-response answer (needs attemptId). */
  selfAssessedCorrect: z.boolean().optional(),
});

export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  const input = await parseJson(req, body);
  const user = await requireUser();
  if (input.selfAssessedCorrect !== undefined) {
    if (!input.attemptId) throw new HttpError(400, "attempt_required", "attemptId is required.");
    return json(
      await submitSelfAssessment(user, {
        sessionId: id,
        attemptId: input.attemptId,
        correct: input.selfAssessedCorrect,
      }),
    );
  }
  if (!input.itemId || input.answer === undefined) {
    throw new HttpError(400, "invalid_input", "itemId and answer are required.");
  }
  return json(
    await submitPracticeAnswer(user, {
      sessionId: id,
      itemId: input.itemId,
      answer: input.answer,
      attemptId: input.attemptId,
      idempotencyKey: input.idempotencyKey,
    }),
  );
});
