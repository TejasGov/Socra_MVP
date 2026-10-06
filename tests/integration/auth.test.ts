import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getUserForSessionToken } from "@/server/auth/current-user";
import { authenticateLocal } from "@/server/auth/local-provider";
import { mapOidcSubject } from "@/server/auth/oidc-provider";
import { can } from "@/server/auth/rbac";
import { createSession, revokeSessionToken } from "@/server/auth/session";
import { disconnectPrisma, prisma } from "@/server/db";

const RUN = randomUUID().slice(0, 8);
const email = `itest-${RUN}@socra.local`;
const courseId = `itest_auth_course_${RUN}`;
let userId = "";

beforeAll(async () => {
  await prisma.course.create({
    data: { id: courseId, code: "TST 100", title: "Test", term: "T", languages: ["PYTHON"] },
  });
  const user = await prisma.user.create({
    data: {
      email,
      name: "Integration Student",
      roles: ["STUDENT"],
      identities: {
        create: {
          provider: "LOCAL",
          issuer: "local",
          subject: email,
          passwordHash: await bcrypt.hash("pw-123456", 4),
        },
      },
      memberships: { create: { courseId, role: "STUDENT" } },
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await disconnectPrisma();
});

describe("local auth + DB sessions", () => {
  it("rejects a wrong password and unknown users", async () => {
    expect(await authenticateLocal({ email, password: "nope" })).toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
    expect(await authenticateLocal({ email: `missing-${RUN}@socra.local`, password: "x" })).toEqual(
      {
        ok: false,
        reason: "invalid_credentials",
      },
    );
  });

  it("accepts the right password (case-insensitive email)", async () => {
    expect(await authenticateLocal({ email: email.toUpperCase(), password: "pw-123456" })).toEqual({
      ok: true,
      userId,
    });
  });

  it("creates, resolves and revokes a session; token is stored hashed", async () => {
    const { token } = await createSession(userId, { userAgent: "vitest" });
    expect(await prisma.session.count({ where: { tokenHash: token } })).toBe(0);
    const user = await getUserForSessionToken(token);
    expect(user?.id).toBe(userId);
    expect(can(user, "assignment:read", { courseId })).toBe(true);
    expect(can(user, "assignment:read", { courseId: "some_other_course" })).toBe(false);
    await revokeSessionToken(token);
    expect(await getUserForSessionToken(token)).toBeNull();
  });

  it("deactivated users cannot authenticate or use sessions", async () => {
    const { token } = await createSession(userId);
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    expect(await authenticateLocal({ email, password: "pw-123456" })).toEqual({
      ok: false,
      reason: "inactive",
    });
    expect(await getUserForSessionToken(token)).toBeNull();
    await prisma.user.update({ where: { id: userId }, data: { isActive: true } });
  });
});

describe("OIDC subject mapping", () => {
  it("links an institutional subject to an existing user by email, then by subject", async () => {
    const issuer = `https://idp-${RUN}.example.edu`;
    expect(
      await mapOidcSubject({ issuer, subject: `sub-${RUN}`, email, emailVerified: true }),
    ).toBe(userId);
    expect(await mapOidcSubject({ issuer, subject: `sub-${RUN}` })).toBe(userId);
  });

  it("never links by an unverified email claim", async () => {
    const issuer = `https://idp2-${RUN}.example.edu`;
    expect(await mapOidcSubject({ issuer, subject: `evil-${RUN}`, email })).toBeNull();
    expect(
      await mapOidcSubject({ issuer, subject: `evil-${RUN}`, email, emailVerified: false }),
    ).toBeNull();
    expect(
      await prisma.authIdentity.count({ where: { issuer, subject: `evil-${RUN}` } }),
    ).toBe(0);
  });

  it("denies unknown subjects when auto-provisioning is off", async () => {
    expect(
      await mapOidcSubject({
        issuer: "https://idp.example.edu",
        subject: `x-${RUN}`,
        email: `nobody-${RUN}@x.edu`,
      }),
    ).toBeNull();
  });
});
