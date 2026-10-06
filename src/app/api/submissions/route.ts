import { after } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";
import { createSubmission } from "@/server/domain/submissions/service";
import { gradeSubmission } from "@/server/domain/grading/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  assignmentId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(200),
  answers: z.array(z.object({ questionId: z.string().min(1), content: z.string() })).max(50),
  clientVersion: z.string().max(100).optional(),
});

/**
 * Idempotent. Responds as soon as the immutable snapshot is stored; grading (hidden tests) runs after the response
 * so a slow or unavailable runner never delays or fails the submission.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const input = await parseJson(req, schema);
  const user = await requireUser();
  const receipt = await createSubmission(user, input);
  if (!receipt.duplicate) {
    after(async () => {
      try {
        await gradeSubmission(receipt.submissionId);
      } catch (err) {
        console.error("[grading] background grading failed", receipt.submissionId, err);
      }
    });
  }
  return json(
    {
      submissionId: receipt.submissionId,
      attemptNumber: receipt.attemptNumber,
      submittedAt: receipt.submittedAt.toISOString(),
      status: receipt.status,
    },
    { status: receipt.duplicate ? 200 : 201 },
  );
});
