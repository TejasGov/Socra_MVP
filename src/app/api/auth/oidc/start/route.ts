import { NextResponse } from "next/server";
import {
  OIDC_FLOW_COOKIE,
  OidcNotConfiguredError,
  beginOidcLogin,
  isOidcConfigured,
} from "@/server/auth/oidc-provider";
import { secureCookiesEnabled } from "@/server/auth/session";
import { errorResponse } from "@/server/http";

export const dynamic = "force-dynamic";

/** Starts university SSO (authorization code + PKCE). 503 with an explanation when OIDC_* is not configured. */
export async function GET(req: Request) {
  if (!isOidcConfigured()) {
    return errorResponse(503, "oidc_not_configured", new OidcNotConfiguredError().message);
  }
  try {
    const next = new URL(req.url).searchParams.get("next");
    const { url, flowCookie } = await beginOidcLogin(next);
    const res = NextResponse.redirect(url, 302);
    res.cookies.set(OIDC_FLOW_COOKIE, flowCookie, {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookiesEnabled(),
      path: "/api/auth/oidc",
      maxAge: 600,
    });
    return res;
  } catch (err) {
    console.error("[oidc] start failed", err);
    return errorResponse(
      502,
      "oidc_discovery_failed",
      "Could not reach the university identity provider.",
    );
  }
}
