import { requireUser } from "@/server/auth/current-user";
import { auditQuerySchema, listAuditLog } from "@/server/domain/admin/audit-view";
import { json, parseQuery, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const user = await requireUser();
  return json(await listAuditLog(user, parseQuery(req, auditQuerySchema)));
});
