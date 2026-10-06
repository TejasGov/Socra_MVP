import { requireUser } from "@/server/auth/current-user";
import { getUsage, usageQuerySchema } from "@/server/domain/admin/usage";
import { json, parseQuery, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const user = await requireUser();
  return json(await getUsage(user, parseQuery(req, usageQuerySchema)));
});
