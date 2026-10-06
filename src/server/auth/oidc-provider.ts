import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import * as oidc from "openid-client";
import { prisma } from "../db";
import { env } from "../env";

/**
 * Generic OpenID Connect adapter for university SSO (authorization code + PKCE, `openid-client` v6).
 *
 * Flow:
 *   GET /api/auth/oidc/start     -> builds authorization URL, stores {state, nonce, codeVerifier, next} in a signed,
 *                                   httpOnly, 10-minute cookie, redirects to the IdP.
 *   GET /api/auth/oidc/callback  -> validates state/nonce/PKCE, exchanges the code, maps the institutional `sub`
 *                                   to an AuthIdentity(provider=OIDC, issuer, subject=sub), creates a session.
 *
 * Mapping rules (docs/ASSUMPTIONS.md):
 *   1. Existing AuthIdentity(OIDC, issuer, sub)                    -> that user.
 *   2. Else, only when the IdP asserts `email_verified === true`, an existing user whose email matches the claim
 *                                                                   -> link a new AuthIdentity to them.
 *   3. Else if OIDC_AUTO_PROVISION=true and the email is verified   -> create a STUDENT user + identity.
 *   4. Else                                                         -> deny ("not_provisioned").
 * An unverified (or absent) email is never used: the subject can then only sign in through an existing
 * (issuer, sub) identity, so an IdP account with a self-asserted email cannot take over a local account.
 * Only the `sub` and the configured email claim are used; no other institutional identifiers are stored.
 */

export const OIDC_FLOW_COOKIE = "socra_oidc_flow";
const FLOW_TTL_MS = 10 * 60 * 1000;

export class OidcNotConfiguredError extends Error {
  constructor() {
    super(
      "University SSO (OIDC) is not configured. Set OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET and " +
        "OIDC_REDIRECT_URI to enable it. Local accounts remain available when AUTH_LOCAL_ENABLED=true.",
    );
    this.name = "OidcNotConfiguredError";
  }
}

export function isOidcConfigured(): boolean {
  return env().OIDC_CONFIGURED;
}

let configPromise: Promise<oidc.Configuration> | undefined;

/** Discovered + cached client configuration. */
export async function getOidcConfig(): Promise<oidc.Configuration> {
  const e = env();
  if (!e.OIDC_CONFIGURED || !e.OIDC_ISSUER || !e.OIDC_CLIENT_ID || !e.OIDC_CLIENT_SECRET) {
    throw new OidcNotConfiguredError();
  }
  configPromise ??= oidc
    .discovery(new URL(e.OIDC_ISSUER), e.OIDC_CLIENT_ID, e.OIDC_CLIENT_SECRET)
    .catch((err: unknown) => {
      configPromise = undefined;
      throw err;
    });
  return configPromise;
}

export interface OidcFlowState {
  state: string;
  nonce: string;
  codeVerifier: string;
  next: string;
  createdAt: number;
}

function sign(payload: string): string {
  return createHmac("sha256", env().SESSION_SECRET).update(`oidc:${payload}`).digest("base64url");
}

export function encodeFlowCookie(flow: OidcFlowState): string {
  const payload = Buffer.from(JSON.stringify(flow)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeFlowCookie(value: string | undefined): OidcFlowState | null {
  if (!value) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const flow = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OidcFlowState;
    if (Date.now() - flow.createdAt > FLOW_TTL_MS) return null;
    return flow;
  } catch {
    return null;
  }
}

/** Only allow same-site relative redirects after login. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

export async function beginOidcLogin(
  nextPath?: string | null,
): Promise<{ url: URL; flowCookie: string }> {
  const config = await getOidcConfig();
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: env().OIDC_REDIRECT_URI ?? `${env().APP_URL}/api/auth/oidc/callback`,
    scope: env().OIDC_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    nonce,
  });
  const flowCookie = encodeFlowCookie({
    state,
    nonce,
    codeVerifier,
    next: safeNextPath(nextPath),
    createdAt: Date.now(),
  });
  return { url, flowCookie };
}

export type OidcCallbackResult =
  | { ok: true; userId: string; next: string }
  | { ok: false; reason: "invalid_flow" | "not_provisioned" | "inactive" | "missing_subject" };

export async function completeOidcLogin(
  currentUrl: URL,
  flow: OidcFlowState | null,
): Promise<OidcCallbackResult> {
  if (!flow) return { ok: false, reason: "invalid_flow" };
  const config = await getOidcConfig();
  const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: flow.codeVerifier,
    expectedState: flow.state,
    expectedNonce: flow.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims?.sub) return { ok: false, reason: "missing_subject" };
  const issuer = config.serverMetadata().issuer;
  const emailClaim = claims[env().OIDC_EMAIL_CLAIM];
  const email = typeof emailClaim === "string" ? emailClaim.trim().toLowerCase() : undefined;
  const nameClaim = typeof claims.name === "string" ? claims.name : undefined;
  const emailVerified = claims.email_verified === true;

  const userId = await mapOidcSubject({
    issuer,
    subject: claims.sub,
    email,
    emailVerified,
    name: nameClaim,
  });
  if (!userId) return { ok: false, reason: "not_provisioned" };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!user?.isActive) return { ok: false, reason: "inactive" };
  return { ok: true, userId, next: flow.next };
}

/** Map (issuer, sub) to an internal user id per the rules above. Exported for tests. */
export async function mapOidcSubject(input: {
  issuer: string;
  subject: string;
  email?: string;
  /** Must be exactly `true` (the IdP's `email_verified` claim) before the email is used for linking. */
  emailVerified?: boolean;
  name?: string;
}): Promise<string | null> {
  const existing = await prisma.authIdentity.findUnique({
    where: {
      provider_issuer_subject: { provider: "OIDC", issuer: input.issuer, subject: input.subject },
    },
    select: { id: true, userId: true },
  });
  if (existing) {
    await prisma.authIdentity.update({
      where: { id: existing.id },
      data: { lastUsedAt: new Date() },
    });
    return existing.userId;
  }
  if (input.email && input.emailVerified === true) {
    const byEmail = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (byEmail) {
      await prisma.authIdentity.create({
        data: {
          userId: byEmail.id,
          provider: "OIDC",
          issuer: input.issuer,
          subject: input.subject,
          lastUsedAt: new Date(),
        },
      });
      return byEmail.id;
    }
    if (env().OIDC_AUTO_PROVISION) {
      const created = await prisma.user.create({
        data: {
          email: input.email,
          name: input.name ?? input.email,
          roles: ["STUDENT"],
          identities: {
            create: {
              provider: "OIDC",
              issuer: input.issuer,
              subject: input.subject,
              lastUsedAt: new Date(),
            },
          },
        },
      });
      return created.id;
    }
  }
  return null;
}
