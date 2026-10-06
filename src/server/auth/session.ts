import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { AuthProvider } from "@/generated/prisma/enums";
import { prisma } from "../db";
import { env } from "../env";

/**
 * DB-backed sessions.
 * - Cookie: random 32-byte token (base64url), httpOnly, SameSite=Lax, Secure when served over https in production.
 * - DB stores HMAC-SHA256(token, SESSION_SECRET) only; the raw token never touches the database.
 * - Absolute expiry = SESSION_TTL_HOURS; `lastSeenAt` is refreshed at most every 5 minutes.
 */

export const SESSION_COOKIE = "socra_session";
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
  provider?: AuthProvider;
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHmac("sha256", env().SESSION_SECRET).update(token).digest("hex");
}

export async function createSession(
  userId: string,
  meta: SessionMeta = {},
): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_HOURS * 3600 * 1000);
  const session = await prisma.session.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt,
      userAgent: meta.userAgent?.slice(0, 400) ?? null,
      ip: meta.ip ?? null,
      provider: meta.provider ?? "LOCAL",
    },
  });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return { token, expiresAt, sessionId: session.id };
}

/** Session row (with user) for a raw token, or null if missing / expired / revoked / user inactive. */
export async function validateSessionToken(token: string) {
  if (!token || token.length > 200) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { select: { id: true, isActive: true } } },
  });
  if (!session) return null;
  const now = Date.now();
  if (session.revokedAt || session.expiresAt.getTime() <= now || !session.user.isActive)
    return null;
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } })
      .catch(() => undefined);
  }
  return session;
}

export async function revokeSessionToken(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashSessionToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserSessions(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Cookie helpers (route handlers / server actions only)
// ---------------------------------------------------------------------------

/**
 * `Secure` in production. The only exception is a production build served over plain http on loopback
 * (`npm run start` / E2E against http://localhost), where browsers would otherwise drop the cookie. A production
 * deployment with a non-loopback http APP_URL still gets `Secure` (sign-in then fails closed instead of sending the
 * session over cleartext).
 */
export function secureCookiesEnabled(): boolean {
  const e = env();
  if (!e.IS_PRODUCTION) return false;
  try {
    const u = new URL(e.APP_URL);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
    return !(u.protocol === "http:" && loopback);
  } catch {
    return true;
  }
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureCookiesEnabled(),
    path: "/",
    expires: expiresAt,
  };
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...sessionCookieOptions(new Date(0)), maxAge: 0 });
}

export async function readSessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value;
}

/** Revoke the current cookie's session (if any) and clear the cookie. */
export async function destroyCurrentSession(): Promise<void> {
  const token = await readSessionCookie();
  if (token) await revokeSessionToken(token);
  await clearSessionCookie();
}
