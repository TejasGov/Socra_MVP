import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { assertSameOrigin, json, parseJson, parseQuery, route } from "@/server/http";
import { getDraft, saveDraft } from "@/server/domain/workspace/drafts";

export const dynamic = "force-dynamic";

const putSchema = z.object({
  assignmentId: z.string().min(1),
  questionId: z.string().min(1),
  content: z.string(),
  baseVersion: z.number().int().min(0),
  clientUpdatedAt: z.string().datetime({ offset: true }).optional(),
});

export const PUT = route(async (req) => {
  assertSameOrigin(req);
  const input = await parseJson(req, putSchema);
  const user = await requireUser();
  const res = await saveDraft(user, {
    ...input,
    clientUpdatedAt: input.clientUpdatedAt ? new Date(input.clientUpdatedAt) : null,
  });
  if (res.ok) return json({ version: res.version, savedAt: res.savedAt.toISOString() });
  const { serverVersion, content, savedAt } = res.conflict;
  return json(
    {
      error: { code: "version_conflict", message: "A newer copy exists on the server" },
      serverVersion,
      content,
      savedAt: savedAt.toISOString(),
    },
    { status: 409 },
  );
});

const getSchema = z.object({ assignmentId: z.string().min(1), questionId: z.string().min(1) });

export const GET = route(async (req) => {
  const q = parseQuery(req, getSchema);
  const user = await requireUser();
  const d = await getDraft(user, q.assignmentId, q.questionId);
  return json(
    d
      ? { version: d.version, content: d.content, savedAt: d.savedAt.toISOString() }
      : { version: 0, content: null, savedAt: null },
  );
});
