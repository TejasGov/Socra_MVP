import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { startPracticeSession } from "@/server/domain/practice";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

const body = z.object({ courseId: z.string().min(1), topicId: z.string().min(1).nullish() });

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const input = await parseJson(req, body);
  const user = await requireUser();
  return json(await startPracticeSession(user, input), { status: 201 });
});
