import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import {
  createPrivilegedGrant,
  grantCreateSchema,
  listPrivilegedGrants,
  revokePrivilegedGrant,
} from "@/server/domain/admin/roles";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await requireUser();
  return json({ grants: await listPrivilegedGrants(user) });
});

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const input = await parseJson(req, grantCreateSchema);
  const grant = await createPrivilegedGrant(user, input);
  return json({ id: grant.id, expiresAt: grant.expiresAt }, { status: 201 });
});

export const DELETE = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { grantId, reason } = await parseJson(
    req,
    z.object({ grantId: z.string().min(1), reason: z.string().trim().min(5).max(500) }),
  );
  return json(await revokePrivilegedGrant(user, grantId, reason));
});
