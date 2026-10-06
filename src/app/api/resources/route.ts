import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { ingestResource, listCourseResources } from "@/server/domain/resources/ingest";
import { parseResourceRequest } from "@/server/domain/resources/request";
import { assertSameOrigin, json, parseQuery, route } from "@/server/http";

export const GET = route(async (req) => {
  const { courseId } = parseQuery(req, z.object({ courseId: z.string().min(1) }));
  const user = await requireUser();
  return json({ resources: await listCourseResources(user, courseId) });
});

/** JSON ({courseId,title,type,text,...}) or multipart/form-data with a `file` (.txt/.md). */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const input = await parseResourceRequest(req);
  return json(await ingestResource(user, input), { status: 201 });
});
