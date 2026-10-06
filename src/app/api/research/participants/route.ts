import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import {
  enrollCourseParticipants,
  enrollSchema,
  listParticipants,
} from "@/server/domain/research/participants";
import { assertSameOrigin, json, parseJson, parseQuery, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const user = await requireUser();
  const q = parseQuery(
    req,
    z.object({
      courseId: z.string().min(1).optional(),
      page: z.coerce.number().int().min(1).optional(),
    }),
  );
  return json(await listParticipants(user, q));
});

/** POST { courseId }: enrol active students not yet in the study (balanced assignment). */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  return json(await enrollCourseParticipants(user, await parseJson(req, enrollSchema)));
});
