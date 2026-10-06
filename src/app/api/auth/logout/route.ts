import { NextResponse } from "next/server";
import { writeAudit } from "@/server/audit";
import { getCurrentUser } from "@/server/auth/current-user";
import { destroyCurrentSession } from "@/server/auth/session";
import { env } from "@/server/env";
import { assertSameOrigin, route } from "@/server/http";

/** POST: JSON clients get 200 JSON; HTML form posts get a 303 redirect to /login. */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await getCurrentUser();
  await destroyCurrentSession();
  if (user) {
    await writeAudit({
      actorId: user.id,
      action: "auth.logout",
      targetType: "user",
      targetId: user.id,
    });
  }
  const wantsJson = (req.headers.get("accept") ?? "").includes("application/json");
  if (wantsJson) return NextResponse.json({ ok: true });
  return NextResponse.redirect(new URL("/login", env().APP_URL), 303);
});
