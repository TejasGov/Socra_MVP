import "server-only";
import { createHmac } from "node:crypto";
import { env } from "../env";
import { prisma, type DbOrTx } from "../db";

/**
 * Pseudonymous research ids (PRD §34.1, data-pipelines §1.9).
 * pseudonymousId = "p_" + first 24 hex chars of HMAC-SHA256(userId, RESEARCH_PSEUDONYM_SECRET).
 * Deterministic for a given secret, so events, exports and StudyParticipant rows join without identity.
 * The identity mapping is kept separately in ResearchParticipantMapping (protected, audited reads only).
 */

export const PSEUDONYM_METHOD = "hmac-sha256";
export const PSEUDONYM_KEY_VERSION = 1;

export function pseudonymFor(
  userId: string,
  secret: string = env().RESEARCH_PSEUDONYM_SECRET,
): string {
  return `p_${createHmac("sha256", secret).update(`user:${userId}`).digest("hex").slice(0, 24)}`;
}

/** Ensure the protected mapping row exists (idempotent). Returns the participant id. */
export async function ensureResearchMapping(userId: string, db: DbOrTx = prisma): Promise<string> {
  const participantId = pseudonymFor(userId);
  await db.researchParticipantMapping.upsert({
    where: { userId },
    create: { userId, participantId, method: PSEUDONYM_METHOD, keyVersion: PSEUDONYM_KEY_VERSION },
    update: {},
  });
  return participantId;
}
