import { requireUser } from "@/server/auth/current-user";
import { getSystemHealth } from "@/server/domain/admin/system-health";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await requireUser();
  return json(await getSystemHealth(user));
});
