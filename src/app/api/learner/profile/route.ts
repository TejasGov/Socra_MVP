import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { assertCan, AuthError } from "@/server/auth/rbac";
import { getLearnerProfile } from "@/server/domain/learner";
import { isEnabled } from "@/server/flags";
import { json, parseQuery, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** GET /api/learner/profile?courseId= — the signed-in student's own topic profile only. */
export const GET = route(async (req) => {
  const { courseId } = parseQuery(req, z.object({ courseId: z.string().min(1) }));
  const user = await requireUser();
  assertCan(user, "learner_profile:read_own", { ownerId: user.id, courseId });
  if (!(await isEnabled("learnerProfile", { courseId }))) {
    throw new AuthError(403, "feature_disabled", "Learning profile is turned off for this course");
  }
  return json(await getLearnerProfile(user.id, courseId));
});
