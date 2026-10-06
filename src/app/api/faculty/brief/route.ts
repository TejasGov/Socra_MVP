import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { getCourseOverview } from "@/server/domain/analytics";
import { generateTeachingBrief } from "@/server/domain/authoring-ai";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

const schema = z.object({ courseId: z.string().min(1) });

/** POST { courseId } -> { text, aiRequestId, generatedAt } from already-computed course metrics only. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { courseId } = await parseJson(req, schema);
  const metrics = await getCourseOverview(user, courseId);
  const brief = await generateTeachingBrief(user, { courseId, metrics });
  return json({
    text: brief.text,
    aiRequestId: brief.aiRequestId,
    generatedAt: new Date().toISOString(),
    source: brief.source,
    weekStart: brief.weekStart,
  });
});

// Vercel function limit: long model generations need more than the default.
export const maxDuration = 60;
