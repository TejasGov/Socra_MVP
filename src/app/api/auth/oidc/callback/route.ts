import { NextResponse, type NextRequest } from "next/server";
import { writeAudit } from "@/server/audit";
import {
  OIDC_FLOW_COOKIE,
  OidcNotConfiguredError,
  completeOidcLogin,
  decodeFlowCookie,
  isOidcConfigured,
} from "@/server/auth/oidc-provider";
import { SESSION_COOKIE, createSession, sessionCookieOptions } from "@/server/auth/session";
import { env } from "@/server/env";
import { clientIp, errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

const FAILURE_CODES: Record<string, string> = {
  not_provisioned: "sso_not_provisioned",
  inactive: "sso_inactive",
};

export async function GET(req: NextRequest) {
  if (!isOidcConfigured()) {
    return errorResponse(503, "oidc_not_configured", new OidcNotConfiguredError().message);
  }
  const base = env().APP_URL;
  const flow = decodeFlowCookie(req.cookies.get(OIDC_FLOW_COOKIE)?.value);

  try {
    // Validate against the configured redirect URI so reverse proxies do not break issuer checks.
    const currentUrl = new URL(env().OIDC_REDIRECT_URI ?? `${base}/api/auth/oidc/callback`);
    currentUrl.search = new URL(req.url).search;
    const result = await completeOidcLogin(currentUrl, flow);
    if (!result.ok) {
      await writeAudit({
        actorId: null,
        action: "auth.login_failed",
        targetType: "oidc",
        metadata: { reason: result.reason },
      });
      const code = FAILURE_CODES[result.reason] ?? "sso_failed";
      const res = NextResponse.redirect(new URL(`/login?error=${code}`, base), 303);
      res.cookies.delete(OIDC_FLOW_COOKIE);
      return res;
    }
    const { token, expiresAt } = await createSession(result.userId, {
      userAgent: req.headers.get("user-agent"),
      ip: clientIp(req),
      provider: "OIDC",
    });
    await writeAudit({
      actorId: result.userId,
      action: "auth.login",
      targetType: "user",
      targetId: result.userId,
      metadata: { provider: "OIDC" },
    });
    const res = NextResponse.redirect(new URL(result.next, base), 303);
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
    res.cookies.delete(OIDC_FLOW_COOKIE);
    return res;
  } catch (err) {
    console.error("[oidc] callback failed", err);
    return NextResponse.redirect(new URL("/login?error=sso_failed", base), 303);
  }
}
