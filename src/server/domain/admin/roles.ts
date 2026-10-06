import "server-only";
import { z } from "zod";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { HttpError } from "@/server/http";
import { assertCan, MIN_PRIVILEGED_REASON_LENGTH, type Principal } from "@/server/auth/rbac";

export const GLOBAL_ROLES = [
  "STUDENT",
  "TA",
  "INSTRUCTOR",
  "RESEARCH_ADMIN",
  "SYSTEM_ADMIN",
] as const;

export const roleChangeSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(GLOBAL_ROLES),
  action: z.enum(["grant", "revoke"]),
  reason: z.string().trim().min(5, "Give a short reason").max(500),
});

export async function listUsersForAdmin(user: Principal, query?: string) {
  assertCan(user, "admin:users:manage");
  const q = query?.trim();
  return prisma.user.findMany({
    where: q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } },
          ],
        }
      : { roles: { hasSome: ["SYSTEM_ADMIN", "RESEARCH_ADMIN", "INSTRUCTOR", "TA"] } },
    orderBy: { email: "asc" },
    take: 50,
    select: { id: true, email: true, name: true, roles: true, isActive: true },
  });
}

/** Grant or revoke a global role. Audited with a reason. Guards against removing the last SYSTEM_ADMIN. */
export async function changeGlobalRole(user: Principal, input: z.infer<typeof roleChangeSchema>) {
  assertCan(user, "admin:roles:manage");
  return prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: input.userId } });
    if (!target) throw new HttpError(404, "user_not_found", "User not found");
    const has = target.roles.includes(input.role);
    let roles = target.roles;
    if (input.action === "grant") {
      if (has) throw new HttpError(409, "role_already_held", "User already has that role");
      roles = [...target.roles, input.role];
    } else {
      if (!has) throw new HttpError(409, "role_not_held", "User does not have that role");
      if (input.role === "SYSTEM_ADMIN") {
        if (target.id === user.id) {
          throw new HttpError(409, "self_revoke", "You cannot remove your own administrator role");
        }
        const admins = await tx.user.count({
          where: { roles: { has: "SYSTEM_ADMIN" }, isActive: true },
        });
        if (admins <= 1) {
          throw new HttpError(409, "last_admin", "At least one system administrator is required");
        }
      }
      roles = target.roles.filter((r) => r !== input.role);
      if (roles.length === 0) roles = ["STUDENT"];
    }
    await tx.user.update({ where: { id: target.id }, data: { roles } });
    await writeAudit(
      {
        actorId: user.id,
        action: "role.change",
        targetType: "User",
        targetId: target.id,
        reason: input.reason,
        metadata: { change: input.action, role: input.role, before: target.roles, after: roles },
      },
      tx,
    );
    return { userId: target.id, roles };
  });
}

export const MAX_GRANT_DAYS = 90;

export const grantCreateSchema = z.object({
  userId: z.string().min(1),
  permission: z.literal("TRANSCRIPT_READ_RAW"),
  reason: z
    .string()
    .trim()
    .min(MIN_PRIVILEGED_REASON_LENGTH, "Give a specific reason (10+ characters)")
    .max(1000),
  protocolReference: z.string().trim().max(200).optional(),
  expiresAt: z.coerce.date(),
});

/** Create a privileged access grant. Only SYSTEM_ADMIN / RESEARCH_ADMIN holders can ever use transcript:read_raw. */
export async function createPrivilegedGrant(
  user: Principal,
  input: z.infer<typeof grantCreateSchema>,
) {
  assertCan(user, "admin:grants:manage");
  const now = Date.now();
  if (input.expiresAt.getTime() <= now) {
    throw new HttpError(400, "expiry_in_past", "Expiry must be in the future");
  }
  if (input.expiresAt.getTime() > now + MAX_GRANT_DAYS * 86_400_000) {
    throw new HttpError(400, "expiry_too_long", `Grants last at most ${MAX_GRANT_DAYS} days`);
  }
  return prisma.$transaction(async (tx) => {
    // Separation of duties: raw transcript access must be approved by a different administrator.
    if (input.userId === user.id) {
      throw new HttpError(
        409,
        "self_grant",
        "You cannot grant privileged access to yourself; another administrator must approve it",
      );
    }
    const target = await tx.user.findUnique({ where: { id: input.userId } });
    if (!target || !target.isActive) throw new HttpError(404, "user_not_found", "User not found");
    if (!target.roles.some((r) => r === "SYSTEM_ADMIN" || r === "RESEARCH_ADMIN")) {
      throw new HttpError(
        409,
        "role_not_eligible",
        "Only system or research administrators can hold raw transcript access",
      );
    }
    const grant = await tx.privilegedAccessGrant.create({
      data: {
        userId: target.id,
        permission: input.permission,
        reason: input.reason,
        protocolReference: input.protocolReference ?? null,
        grantedById: user.id,
        expiresAt: input.expiresAt,
      },
    });
    await writeAudit(
      {
        actorId: user.id,
        action: "grant.create",
        targetType: "PrivilegedAccessGrant",
        targetId: grant.id,
        reason: input.reason,
        metadata: {
          holderId: target.id,
          permission: input.permission,
          expiresAt: input.expiresAt.toISOString(),
          protocolReference: input.protocolReference ?? null,
        },
      },
      tx,
    );
    return grant;
  });
}

export async function revokePrivilegedGrant(user: Principal, grantId: string, reason: string) {
  assertCan(user, "admin:grants:manage");
  if (reason.trim().length < 5) throw new HttpError(400, "reason_required", "Give a short reason");
  return prisma.$transaction(async (tx) => {
    const grant = await tx.privilegedAccessGrant.findUnique({ where: { id: grantId } });
    if (!grant) throw new HttpError(404, "grant_not_found", "Grant not found");
    if (grant.revokedAt) throw new HttpError(409, "already_revoked", "Grant already revoked");
    await tx.privilegedAccessGrant.update({
      where: { id: grantId },
      data: { revokedAt: new Date() },
    });
    await writeAudit(
      {
        actorId: user.id,
        action: "grant.revoke",
        targetType: "PrivilegedAccessGrant",
        targetId: grantId,
        reason,
        metadata: { holderId: grant.userId, permission: grant.permission },
      },
      tx,
    );
    return { revoked: true };
  });
}

export async function listPrivilegedGrants(user: Principal) {
  assertCan(user, "admin:grants:manage");
  const rows = await prisma.privilegedAccessGrant.findMany({
    orderBy: { grantedAt: "desc" },
    take: 50,
    include: {
      user: { select: { email: true, name: true } },
      grantedBy: { select: { email: true } },
    },
  });
  const now = Date.now();
  return rows.map((g) => ({
    id: g.id,
    holderEmail: g.user.email,
    holderName: g.user.name,
    permission: g.permission,
    reason: g.reason,
    protocolReference: g.protocolReference,
    grantedByEmail: g.grantedBy.email,
    grantedAt: g.grantedAt,
    expiresAt: g.expiresAt,
    revokedAt: g.revokedAt,
    active: !g.revokedAt && g.expiresAt.getTime() > now,
  }));
}
