import "server-only";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { burnPasswordCheck, verifyPassword } from "./password";

/**
 * Local (email + password) authentication for seeded/pilot accounts.
 * Disabled entirely when AUTH_LOCAL_ENABLED=false.
 */

export const localLoginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(1).max(200),
});

export type LocalLoginInput = z.infer<typeof localLoginSchema>;

export type LocalAuthResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "disabled" | "invalid_credentials" | "inactive" };

export async function authenticateLocal(input: LocalLoginInput): Promise<LocalAuthResult> {
  if (!env().AUTH_LOCAL_ENABLED) return { ok: false, reason: "disabled" };
  const email = input.email.trim().toLowerCase();
  const identity = await prisma.authIdentity.findUnique({
    where: { provider_issuer_subject: { provider: "LOCAL", issuer: "local", subject: email } },
    select: { id: true, passwordHash: true, user: { select: { id: true, isActive: true } } },
  });
  if (!identity?.passwordHash) {
    await burnPasswordCheck(input.password);
    return { ok: false, reason: "invalid_credentials" };
  }
  const valid = await verifyPassword(input.password, identity.passwordHash);
  if (!valid) return { ok: false, reason: "invalid_credentials" };
  if (!identity.user.isActive) return { ok: false, reason: "inactive" };
  await prisma.authIdentity.update({
    where: { id: identity.id },
    data: { lastUsedAt: new Date() },
  });
  return { ok: true, userId: identity.user.id };
}
