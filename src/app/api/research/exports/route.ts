import { requireUser } from "@/server/auth/current-user";
import { describeAllowlist, DEFAULT_EXPORT_FIELDS } from "@/server/domain/research/allowlist";
import {
  createResearchExport,
  exportRequestSchema,
  listResearchExports,
} from "@/server/domain/research/export";
import { assertCan } from "@/server/auth/rbac";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await requireUser();
  assertCan(user, "research:read");
  return json({
    exports: await listResearchExports(user),
    allowlist: describeAllowlist(),
    defaults: DEFAULT_EXPORT_FIELDS,
  });
});

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const input = await parseJson(req, exportRequestSchema);
  return json(await createResearchExport(user, input), { status: 201 });
});
