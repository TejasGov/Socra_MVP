import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import {
  getJobsOverview,
  outboxRetrySchema,
  resolveJobFailure,
  retryFailedOutbox,
} from "@/server/domain/admin/jobs";
import { assertSameOrigin, HttpError, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await requireUser();
  return json(await getJobsOverview(user));
});

/** POST body: { action: "retry_outbox", ids? } or { action: "resolve_failure", failureId } */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const body = await parseJson(
    req,
    z.discriminatedUnion("action", [
      z.object({ action: z.literal("retry_outbox") }).extend(outboxRetrySchema.shape),
      z.object({ action: z.literal("resolve_failure"), failureId: z.string().min(1) }),
    ]),
  );
  if (body.action === "retry_outbox") return json(await retryFailedOutbox(user, { ids: body.ids }));
  if (body.action === "resolve_failure") return json(await resolveJobFailure(user, body.failureId));
  throw new HttpError(400, "unknown_action");
});
