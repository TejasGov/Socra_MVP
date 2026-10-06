import { requireUser } from "@/server/auth/current-user";
import { changeGlobalRole, listUsersForAdmin, roleChangeSchema } from "@/server/domain/admin/roles";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const user = await requireUser();
  const q = new URL(req.url).searchParams.get("q") ?? undefined;
  return json({ users: await listUsersForAdmin(user, q) });
});

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const input = await parseJson(req, roleChangeSchema);
  return json(await changeGlobalRole(user, input));
});
