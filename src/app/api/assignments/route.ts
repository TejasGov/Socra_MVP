import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { assertSameOrigin, json, parseJson, parseQuery, route } from "@/server/http";
import { createAssignment, listAssignmentsForFaculty } from "@/server/domain/assignments/service";

export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const body = await parseJson(req, z.looseObject({}));
  const user = await requireUser();
  const created = await createAssignment(user, body);
  return json(created, { status: 201 });
});

export const GET = route(async (req) => {
  const q = parseQuery(req, z.object({ courseId: z.string().optional() }));
  const user = await requireUser();
  return json({ assignments: await listAssignmentsForFaculty(user, q) });
});
