import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { AuthError, canAccessArea, type Area } from "./rbac";
import { readSessionCookie, validateSessionToken } from "./session";

export { loadPrincipal, type CurrentUser } from "./principal";
import { loadPrincipal, type CurrentUser } from "./principal";

/** Resolve a raw session token to a CurrentUser (no cookies involved; used by tests and non-Next callers). */
export async function getUserForSessionToken(token: string): Promise<CurrentUser | null> {
  const session = await validateSessionToken(token);
  if (!session) return null;
  return loadPrincipal(session.userId, session.id);
}

/** Per-request memoized current user from the session cookie; null when signed out. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = await readSessionCookie();
  if (!token) return null;
  return getUserForSessionToken(token);
});

/** Route handlers / actions: throws AuthError(401) when signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401, "unauthenticated");
  return user;
}

/** Route handlers / actions: throws AuthError(403) unless the user holds one of the global roles. */
export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.some((r) => user.roles.includes(r))) throw new AuthError(403, "missing_role");
  return user;
}

/** Server components/pages: redirects to /login when signed out. */
export async function requirePageUser(nextPath?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  return user;
}

/** Area layouts: redirect to /login (signed out) or /forbidden (wrong area). */
export async function requireArea(area: Area, nextPath?: string): Promise<CurrentUser> {
  const user = await requirePageUser(nextPath);
  if (!canAccessArea(user, area)) redirect("/forbidden");
  return user;
}
