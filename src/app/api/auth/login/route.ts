import { z } from "zod";
import { writeAudit } from "@/server/audit";
import { loadPrincipal } from "@/server/auth/current-user";
import { authenticateLocal, localLoginSchema } from "@/server/auth/local-provider";
import { safeNextPath } from "@/server/auth/oidc-provider";
import { rateLimit } from "@/server/auth/rate-limit";
import { homePathFor } from "@/server/auth/rbac";
import { createSession, setSessionCookie } from "@/server/auth/session";
import { env } from "@/server/env";
import { HttpError, assertSameOrigin, clientIp, json, parseJson, route } from "@/server/http";

const bodySchema = localLoginSchema.extend({ next: z.string().max(500).optional() });

export const POST = route(async (req) => {
  assertSameOrigin(req);
  const input = await parseJson(req, bodySchema);
  const ip = clientIp(req);
  const windowMs = 15 * 60 * 1000;
  // Per account (all sources when no trusted proxy supplies the IP) ...
  const limit = await rateLimit(
    `login:${ip ?? "unknown"}:${input.email.trim().toLowerCase()}`,
    env().RATE_LIMIT_LOGIN_PER_15_MIN,
    windowMs,
  );
  // ... and per source IP across accounts (credential stuffing), when the IP is trustworthy.
  const ipLimit = ip
    ? await rateLimit(`login-ip:${ip}`, env().RATE_LIMIT_LOGIN_PER_15_MIN * 5, windowMs)
    : { allowed: true };
  if (!limit.allowed || !ipLimit.allowed) {
    throw new HttpError(429, "rate_limited", "Too many sign-in attempts. Try again later.");
  }

  const result = await authenticateLocal(input);
  if (!result.ok) {
    await writeAudit({
      actorId: null,
      action: "auth.login_failed",
      targetType: "auth",
      metadata: { reason: result.reason },
      ip,
      userAgent: req.headers.get("user-agent"),
    });
    if (result.reason === "disabled") {
      throw new HttpError(403, "local_auth_disabled", "Password sign-in is disabled.");
    }
    throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
  }

  const { token, expiresAt } = await createSession(result.userId, {
    userAgent: req.headers.get("user-agent"),
    ip,
    provider: "LOCAL",
  });
  await setSessionCookie(token, expiresAt);
  await writeAudit({
    actorId: result.userId,
    action: "auth.login",
    targetType: "user",
    targetId: result.userId,
    ip,
  });

  const user = await loadPrincipal(result.userId);
  if (!user) throw new HttpError(401, "invalid_credentials", "Email or password is incorrect.");
  const redirectTo = input.next ? safeNextPath(input.next) : homePathFor(user);
  return json({
    user: { id: user.id, email: user.email, name: user.name, roles: user.roles },
    redirectTo,
  });
});
