import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic route protection (Next.js 16 "proxy", formerly middleware).
 * Only checks for the presence of a session cookie and redirects signed-out users to /login.
 * Real authorization (session validity, roles, course membership) happens server-side in every layout,
 * page and route handler via src/server/auth.
 */

const SESSION_COOKIE = "socra_session";

const PROTECTED_PREFIXES = [
  "/home",
  "/courses",
  "/practice",
  "/profile",
  "/history",
  "/privacy",
  "/faculty",
  "/admin",
  "/research",
];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (isProtected && !request.cookies.get(SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
