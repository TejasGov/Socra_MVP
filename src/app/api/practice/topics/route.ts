import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { getPracticeTopics } from "@/server/domain/practice";
import { json, parseQuery, route } from "@/server/http";

export const GET = route(async (req) => {
  const { courseId } = parseQuery(req, z.object({ courseId: z.string().min(1) }));
  const user = await requireUser();
  return json({ topics: await getPracticeTopics(user, courseId) });
});
