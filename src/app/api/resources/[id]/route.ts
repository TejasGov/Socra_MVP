import { requireUser } from "@/server/auth/current-user";
import { archiveResource, ingestResource } from "@/server/domain/resources/ingest";
import { parseResourceRequest } from "@/server/domain/resources/request";
import { prisma } from "@/server/db";
import { assertSameOrigin, HttpError, json, route } from "@/server/http";

async function courseOf(id: string): Promise<string> {
  const r = await prisma.courseResource.findUnique({ where: { id }, select: { courseId: true } });
  if (!r) throw new HttpError(404, "resource_not_found", "Resource not found.");
  return r.courseId;
}

/** New version: same body as POST /api/resources (courseId is taken from the resource). */
export const PUT = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  const user = await requireUser();
  const courseId = await courseOf(id);
  const input = await parseResourceRequest(req, { courseId, resourceId: id });
  return json(await ingestResource(user, input));
});

/** Archives (soft delete); chunks stay so past citations remain valid. */
export const DELETE = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const { id } = await ctx.params;
  const user = await requireUser();
  await archiveResource(user, await courseOf(id), id);
  return json({ ok: true });
});
