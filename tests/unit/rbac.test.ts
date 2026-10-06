import { describe, expect, it } from "vitest";
import {
  assertCan,
  authorize,
  can,
  canAccessArea,
  homePathFor,
  type Principal,
} from "@/server/auth/rbac";

const COURSE_A = "course_a";
const COURSE_B = "course_b";
const future = new Date(Date.now() + 3600_000);
const past = new Date(Date.now() - 3600_000);

function principal(p: Partial<Principal> & { id: string }): Principal {
  return { roles: [], isActive: true, memberships: [], grants: [], ...p };
}

const student = principal({
  id: "s1",
  roles: ["STUDENT"],
  memberships: [{ courseId: COURSE_A, role: "STUDENT", status: "ACTIVE" }],
});
const instructor = principal({
  id: "i1",
  roles: ["INSTRUCTOR"],
  memberships: [{ courseId: COURSE_A, role: "INSTRUCTOR", status: "ACTIVE" }],
});
const ta = principal({
  id: "t1",
  roles: ["TA"],
  memberships: [{ courseId: COURSE_A, role: "TA", status: "ACTIVE" }],
});
const sysadmin = principal({ id: "a1", roles: ["SYSTEM_ADMIN"] });
const researcher = principal({ id: "r1", roles: ["RESEARCH_ADMIN"] });

describe("rbac: course scope", () => {
  it("instructor can publish in own course", () => {
    expect(can(instructor, "assignment:publish", { courseId: COURSE_A })).toBe(true);
  });

  it("instructor cannot act in another course by guessing its id", () => {
    expect(can(instructor, "assignment:publish", { courseId: COURSE_B })).toBe(false);
    expect(can(instructor, "analytics:course:read", { courseId: COURSE_B })).toBe(false);
    expect(authorize(instructor, "submission:read_course", { courseId: COURSE_B }).reason).toBe(
      "not_course_member",
    );
  });

  it("course permission without courseId is denied", () => {
    expect(authorize(instructor, "assignment:publish").reason).toBe("course_required");
  });

  it("students cannot read hidden tests, analytics, or peer submissions", () => {
    expect(can(student, "assignment:hidden_tests:read", { courseId: COURSE_A })).toBe(false);
    expect(can(student, "analytics:course:read", { courseId: COURSE_A })).toBe(false);
    expect(can(student, "submission:read_course", { courseId: COURSE_A })).toBe(false);
  });

  it("TA can grade but not finalize, override or publish", () => {
    expect(can(ta, "grade:write", { courseId: COURSE_A })).toBe(true);
    expect(can(ta, "grade:finalize", { courseId: COURSE_A })).toBe(false);
    expect(can(ta, "grade:override", { courseId: COURSE_A })).toBe(false);
    expect(can(ta, "assignment:publish", { courseId: COURSE_A })).toBe(false);
  });

  it("dropped memberships grant nothing", () => {
    const dropped = principal({
      id: "s2",
      roles: ["STUDENT"],
      memberships: [{ courseId: COURSE_A, role: "STUDENT", status: "DROPPED" }],
    });
    expect(can(dropped, "assignment:read", { courseId: COURSE_A })).toBe(false);
  });

  it("system admin may close/reopen but not grade or read analytics", () => {
    expect(can(sysadmin, "assignment:close", { courseId: COURSE_A })).toBe(true);
    expect(can(sysadmin, "assignment:reopen", { courseId: COURSE_A })).toBe(true);
    expect(can(sysadmin, "grade:finalize", { courseId: COURSE_A })).toBe(false);
    expect(can(sysadmin, "analytics:course:read", { courseId: COURSE_A })).toBe(false);
  });
});

describe("rbac: ownership", () => {
  it("student can write own draft in enrolled course", () => {
    expect(can(student, "draft:write_own", { ownerId: "s1", courseId: COURSE_A })).toBe(true);
  });

  it("student cannot write another student's draft", () => {
    expect(
      authorize(student, "draft:write_own", { ownerId: "s9", courseId: COURSE_A }).reason,
    ).toBe("not_owner");
  });

  it("own permission requires ownerId", () => {
    expect(authorize(student, "submission:create_own", { courseId: COURSE_A }).reason).toBe(
      "owner_required",
    );
  });

  it("student cannot submit into a course they are not enrolled in", () => {
    expect(can(student, "submission:create_own", { ownerId: "s1", courseId: COURSE_B })).toBe(
      false,
    );
  });

  it("instructor cannot submit as a student", () => {
    expect(can(instructor, "submission:create_own", { ownerId: "i1", courseId: COURSE_A })).toBe(
      false,
    );
  });
});

describe("rbac: raw transcripts", () => {
  const reason = "IRB protocol 2026-114 debugging request";

  it("ordinary instructor is always denied, even with a grant and a reason", () => {
    const withGrant = principal({
      ...instructor,
      grants: [{ permission: "TRANSCRIPT_READ_RAW", expiresAt: future, revokedAt: null }],
    });
    expect(can(withGrant, "transcript:read_raw", { courseId: COURSE_A, reason })).toBe(false);
    expect(authorize(withGrant, "transcript:read_raw", { reason }).reason).toBe(
      "role_not_eligible_for_raw_transcripts",
    );
  });

  it("research admin without a grant is denied", () => {
    expect(authorize(researcher, "transcript:read_raw", { reason }).reason).toBe(
      "no_active_privileged_grant",
    );
  });

  it("research admin with an active grant but no reason is denied", () => {
    const r = principal({
      ...researcher,
      grants: [{ permission: "TRANSCRIPT_READ_RAW", expiresAt: future, revokedAt: null }],
    });
    expect(authorize(r, "transcript:read_raw", {}).reason).toBe("reason_required");
    expect(authorize(r, "transcript:read_raw", { reason: "short" }).reason).toBe("reason_required");
  });

  it("expired or revoked grants do not count", () => {
    const expired = principal({
      ...researcher,
      grants: [{ permission: "TRANSCRIPT_READ_RAW", expiresAt: past, revokedAt: null }],
    });
    const revoked = principal({
      ...researcher,
      grants: [{ permission: "TRANSCRIPT_READ_RAW", expiresAt: future, revokedAt: past }],
    });
    expect(can(expired, "transcript:read_raw", { reason })).toBe(false);
    expect(can(revoked, "transcript:read_raw", { reason })).toBe(false);
  });

  it("system admin / research admin with active grant + reason are allowed", () => {
    for (const base of [researcher, sysadmin]) {
      const p = principal({
        ...base,
        grants: [{ permission: "TRANSCRIPT_READ_RAW", expiresAt: future, revokedAt: null }],
      });
      expect(can(p, "transcript:read_raw", { reason })).toBe(true);
    }
  });
});

describe("rbac: global roles, areas, misc", () => {
  it("research export requires RESEARCH_ADMIN", () => {
    expect(can(researcher, "research:export")).toBe(true);
    expect(can(instructor, "research:export")).toBe(false);
    expect(can(sysadmin, "research:export")).toBe(false);
  });

  it("inactive users are denied everything", () => {
    const inactive = principal({ ...instructor, isActive: false });
    expect(authorize(inactive, "assignment:publish", { courseId: COURSE_A }).reason).toBe(
      "account_inactive",
    );
  });

  it("unauthenticated -> 401 AuthError, denied -> 403", () => {
    expect(() => assertCan(null, "course:read", { courseId: COURSE_A })).toThrowError(
      expect.objectContaining({ status: 401 }),
    );
    expect(() => assertCan(student, "assignment:publish", { courseId: COURSE_A })).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
  });

  it("areas", () => {
    expect(canAccessArea(student, "faculty")).toBe(false);
    expect(canAccessArea(ta, "faculty")).toBe(true);
    expect(canAccessArea(instructor, "admin")).toBe(false);
    expect(canAccessArea(sysadmin, "admin")).toBe(true);
    expect(canAccessArea(researcher, "research")).toBe(true);
    expect(canAccessArea(instructor, "research")).toBe(false);
  });

  it("home paths", () => {
    expect(homePathFor(student)).toBe("/home");
    expect(homePathFor(instructor)).toBe("/faculty");
    expect(homePathFor(sysadmin)).toBe("/admin");
    expect(homePathFor(researcher)).toBe("/research");
  });
});
