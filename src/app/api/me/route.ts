import { requireUser } from "@/server/auth/current-user";
import { homePathFor } from "@/server/auth/rbac";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const user = await requireUser();
  return json({
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles,
    memberships: user.memberships.map((m) => ({ courseId: m.courseId, role: m.role })),
    home: homePathFor(user),
  });
});
