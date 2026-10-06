import { requireUser } from "@/server/auth/current-user";
import { previewRosterImport, rosterPreviewSchema } from "@/server/domain/admin/roster";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** Body: { courseId, fileName, csv } (the CSV text; the browser reads the file). Nothing is applied. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const input = await parseJson(req, rosterPreviewSchema);
  return json(await previewRosterImport(user, input), { status: 201 });
});
