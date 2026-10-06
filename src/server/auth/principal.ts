import "server-only";
import { prisma } from "../db";
import type { Principal } from "./rbac";

// Next.js-free principal loading: safe to import from the worker process.

/** The authenticated user for this request (Principal + display fields). */
export interface CurrentUser extends Principal {
  email: string;
  name: string;
  sessionId: string;
}

/** Load a Principal (active memberships + unexpired grants) for a user id. */
export async function loadPrincipal(userId: string, sessionId = ""): Promise<CurrentUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      roles: true,
      isActive: true,
      memberships: {
        where: { status: "ACTIVE" },
        select: { courseId: true, role: true, status: true },
      },
      privilegedGrants: {
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
        select: { permission: true, expiresAt: true, revokedAt: true },
      },
    },
  });
  if (!user || !user.isActive) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles,
    isActive: user.isActive,
    memberships: user.memberships,
    grants: user.privilegedGrants,
    sessionId,
  };
}
