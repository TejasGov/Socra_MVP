import { requireUser } from "@/server/auth/current-user";
import { flagUpdateSchema, getFlagMatrix, updateFlag } from "@/server/domain/admin/flags";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await requireUser();
  return json(await getFlagMatrix(user));
});

export const PUT = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const input = await parseJson(req, flagUpdateSchema);
  return json(await updateFlag(user, input));
});
