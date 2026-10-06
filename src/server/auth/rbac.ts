import "server-only";
import type {
  CourseRole,
  MembershipStatus,
  PrivilegedPermission,
  Role,
} from "@/generated/prisma/enums";

/**
 * Central authorization policy (role + course membership + ownership + explicit grants).
 *
 * Every route handler / server action / server component that reads or mutates protected data must call
 * `can()` / `assertCan()` (or a helper built on them). UI visibility is never a security boundary.
 *
 * Pure functions: no DB access. Callers load the Principal via `getCurrentUser()` (src/server/auth/current-user.ts),
 * which includes active memberships and unexpired privileged grants.
 */

export interface PrincipalMembership {
  courseId: string;
  role: CourseRole;
  status: MembershipStatus;
}

export interface PrincipalGrant {
  permission: PrivilegedPermission;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface Principal {
  id: string;
  roles: readonly Role[];
  isActive: boolean;
  memberships: readonly PrincipalMembership[];
  /** Privileged grants (e.g. TRANSCRIPT_READ_RAW). Expired/revoked grants are ignored. */
  grants?: readonly PrincipalGrant[];
}

export const PERMISSIONS = [
  // Courses
  "course:read",
  "course:manage",
  "course:roster:manage",
  // Assignments (staff side)
  "assignment:read",
  "assignment:read_staff",
  "assignment:create",
  "assignment:update",
  "assignment:publish",
  "assignment:close",
  "assignment:reopen",
  "assignment:preview",
  "assignment:hidden_tests:read",
  "assignment:release_solutions",
  // Student work
  "draft:write_own",
  "draft:read_own",
  "code:run",
  "submission:create_own",
  "submission:read_own",
  "submission:read_course",
  // Grading
  "grade:write",
  "grade:finalize",
  "grade:override",
  "grade:read_own",
  // Socra / practice / profile
  "socra:use",
  "socra:history:read_own",
  "practice:use",
  "learner_profile:read_own",
  "escalation:read",
  // Faculty analytics (aggregates only — never raw transcripts)
  "analytics:course:read",
  "analytics:individual:read",
  // Course materials
  "resource:read",
  "resource:manage",
  // Faculty AI
  "authoring:ai",
  "analytics:ai_brief",
  // Privileged conversation access
  "transcript:read_raw",
  // Research
  "research:read",
  "research:export",
  "research:condition:manage",
  // Admin
  "admin:flags:manage",
  "admin:ai_config:manage",
  "admin:ai_usage:read",
  "admin:audit:read",
  "admin:jobs:read",
  "admin:health:read",
  "admin:users:manage",
  "admin:roles:manage",
  "admin:grants:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface AuthzContext {
  /** Course the resource belongs to (required for course-scoped permissions). */
  courseId?: string;
  /** Owner of the resource for *_own permissions. */
  ownerId?: string;
  /** Justification text; required for transcript:read_raw. */
  reason?: string;
  /** Evaluation time (tests). */
  now?: Date;
}

export interface AuthzDecision {
  allowed: boolean;
  reason: string;
}

export const MIN_PRIVILEGED_REASON_LENGTH = 10;

const STAFF: readonly CourseRole[] = ["INSTRUCTOR", "TA"];
const INSTRUCTOR_ONLY: readonly CourseRole[] = ["INSTRUCTOR"];
const ANY_MEMBER: readonly CourseRole[] = ["INSTRUCTOR", "TA", "STUDENT"];
const STUDENT_ONLY: readonly CourseRole[] = ["STUDENT"];

/** Course-scoped permissions and the course roles that hold them. */
const COURSE_RULES: Partial<Record<Permission, readonly CourseRole[]>> = {
  "course:read": ANY_MEMBER,
  "course:roster:manage": INSTRUCTOR_ONLY,
  "assignment:read": ANY_MEMBER,
  "assignment:read_staff": STAFF,
  "assignment:create": INSTRUCTOR_ONLY,
  "assignment:update": INSTRUCTOR_ONLY,
  "assignment:publish": INSTRUCTOR_ONLY,
  "assignment:close": INSTRUCTOR_ONLY,
  "assignment:reopen": INSTRUCTOR_ONLY,
  "assignment:preview": STAFF,
  "assignment:hidden_tests:read": STAFF,
  "assignment:release_solutions": INSTRUCTOR_ONLY,
  "submission:read_course": STAFF,
  "grade:write": STAFF,
  "grade:finalize": INSTRUCTOR_ONLY,
  "grade:override": INSTRUCTOR_ONLY,
  "escalation:read": STAFF,
  "analytics:course:read": STAFF,
  "analytics:individual:read": INSTRUCTOR_ONLY,
  "resource:read": ANY_MEMBER,
  "resource:manage": INSTRUCTOR_ONLY,
  "authoring:ai": INSTRUCTOR_ONLY,
  "analytics:ai_brief": INSTRUCTOR_ONLY,
  "code:run": ANY_MEMBER,
  "socra:use": STUDENT_ONLY,
  "practice:use": STUDENT_ONLY,
};

/** Own-resource permissions: caller must be the owner AND (when courseId is given) an active course member. */
const OWN_RULES: Partial<Record<Permission, readonly CourseRole[]>> = {
  "draft:write_own": STUDENT_ONLY,
  "draft:read_own": ANY_MEMBER,
  "submission:create_own": STUDENT_ONLY,
  "submission:read_own": ANY_MEMBER,
  "grade:read_own": ANY_MEMBER,
  "learner_profile:read_own": STUDENT_ONLY,
  "socra:history:read_own": ANY_MEMBER,
};

/** Global-role permissions (not course-scoped). */
const GLOBAL_RULES: Partial<Record<Permission, readonly Role[]>> = {
  "course:manage": ["SYSTEM_ADMIN"],
  "research:read": ["RESEARCH_ADMIN"],
  "research:export": ["RESEARCH_ADMIN"],
  "research:condition:manage": ["RESEARCH_ADMIN"],
  "admin:flags:manage": ["SYSTEM_ADMIN"],
  "admin:ai_config:manage": ["SYSTEM_ADMIN"],
  "admin:ai_usage:read": ["SYSTEM_ADMIN"],
  "admin:audit:read": ["SYSTEM_ADMIN"],
  "admin:jobs:read": ["SYSTEM_ADMIN"],
  "admin:health:read": ["SYSTEM_ADMIN"],
  "admin:users:manage": ["SYSTEM_ADMIN"],
  "admin:roles:manage": ["SYSTEM_ADMIN"],
  "admin:grants:manage": ["SYSTEM_ADMIN"],
};

/** SYSTEM_ADMIN operational overrides on course-scoped permissions (PRD §31: close/reopen, roster, course config). */
const SYSTEM_ADMIN_COURSE_OVERRIDES: readonly Permission[] = [
  "course:read",
  "course:roster:manage",
  "assignment:read_staff",
  "assignment:close",
  "assignment:reopen",
];

/** Roles that may ever hold transcript:read_raw (and then only with an active grant + reason). */
const TRANSCRIPT_ROLES: readonly Role[] = ["SYSTEM_ADMIN", "RESEARCH_ADMIN"];

export function hasRole(user: Pick<Principal, "roles">, ...roles: Role[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}

export function activeMembership(
  user: Principal,
  courseId: string,
): PrincipalMembership | undefined {
  return user.memberships.find((m) => m.courseId === courseId && m.status === "ACTIVE");
}

export function courseRole(user: Principal, courseId: string): CourseRole | undefined {
  return activeMembership(user, courseId)?.role;
}

export function isCourseStaff(user: Principal, courseId: string): boolean {
  const role = courseRole(user, courseId);
  return role === "INSTRUCTOR" || role === "TA";
}

export function hasActiveGrant(
  user: Principal,
  permission: PrivilegedPermission,
  now = new Date(),
): boolean {
  return (user.grants ?? []).some(
    (g) =>
      g.permission === permission && g.revokedAt === null && g.expiresAt.getTime() > now.getTime(),
  );
}

const deny = (reason: string): AuthzDecision => ({ allowed: false, reason });
const allow = (reason: string): AuthzDecision => ({ allowed: true, reason });

/** Full decision with a reason (useful for audit logs and debugging). */
export function authorize(
  user: Principal | null | undefined,
  permission: Permission,
  ctx: AuthzContext = {},
): AuthzDecision {
  if (!user) return deny("unauthenticated");
  if (!user.isActive) return deny("account_inactive");

  // Raw transcripts: never implied by any course role (ordinary INSTRUCTORs are always denied).
  if (permission === "transcript:read_raw") {
    if (!hasRole(user, ...TRANSCRIPT_ROLES)) return deny("role_not_eligible_for_raw_transcripts");
    if (!hasActiveGrant(user, "TRANSCRIPT_READ_RAW", ctx.now))
      return deny("no_active_privileged_grant");
    if (!ctx.reason || ctx.reason.trim().length < MIN_PRIVILEGED_REASON_LENGTH) {
      return deny("reason_required");
    }
    return allow("privileged_grant");
  }

  const globalRoles = GLOBAL_RULES[permission];
  if (globalRoles) {
    return hasRole(user, ...globalRoles) ? allow("global_role") : deny("missing_global_role");
  }

  const ownRoles = OWN_RULES[permission];
  if (ownRoles) {
    if (!ctx.ownerId) return deny("owner_required");
    if (ctx.ownerId !== user.id) return deny("not_owner");
    if (ctx.courseId) {
      const role = courseRole(user, ctx.courseId);
      if (!role) return deny("not_course_member");
      if (!ownRoles.includes(role)) return deny("course_role_not_permitted");
    }
    return allow("owner");
  }

  const courseRoles = COURSE_RULES[permission];
  if (courseRoles) {
    if (!ctx.courseId) return deny("course_required");
    const role = courseRole(user, ctx.courseId);
    if (role && courseRoles.includes(role)) return allow("course_role");
    if (hasRole(user, "SYSTEM_ADMIN") && SYSTEM_ADMIN_COURSE_OVERRIDES.includes(permission)) {
      return allow("system_admin_override");
    }
    return deny(role ? "course_role_not_permitted" : "not_course_member");
  }

  return deny("unknown_permission");
}

/** Boolean form. Example: `can(user, "assignment:publish", { courseId })`. */
export function can(
  user: Principal | null | undefined,
  permission: Permission,
  ctx: AuthzContext = {},
): boolean {
  return authorize(user, permission, ctx).allowed;
}

export class AuthError extends Error {
  readonly status: 401 | 403 | 404;
  readonly code: string;
  constructor(status: 401 | 403 | 404, code: string, message?: string) {
    super(message ?? code);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

/** Throws AuthError(401) when unauthenticated, AuthError(403) when denied. */
export function assertCan(
  user: Principal | null | undefined,
  permission: Permission,
  ctx: AuthzContext = {},
): asserts user is Principal {
  const decision = authorize(user, permission, ctx);
  if (!decision.allowed) {
    if (decision.reason === "unauthenticated") throw new AuthError(401, "unauthenticated");
    throw new AuthError(403, decision.reason, `Forbidden: ${permission}`);
  }
}

// ---------------------------------------------------------------------------
// Areas (route groups). Used by the proxy for coarse redirects and by layouts; handlers still call can().
// ---------------------------------------------------------------------------

export type Area = "student" | "faculty" | "admin" | "research";

export function canAccessArea(user: Principal | null | undefined, area: Area): boolean {
  if (!user || !user.isActive) return false;
  switch (area) {
    case "student":
      return true;
    case "faculty":
      return (
        hasRole(user, "INSTRUCTOR", "TA") ||
        user.memberships.some(
          (m) => m.status === "ACTIVE" && (m.role === "INSTRUCTOR" || m.role === "TA"),
        )
      );
    case "admin":
      return hasRole(user, "SYSTEM_ADMIN");
    case "research":
      return hasRole(user, "RESEARCH_ADMIN");
  }
}

/** Where a user lands after login. */
export function homePathFor(user: Pick<Principal, "roles">): string {
  if (user.roles.includes("SYSTEM_ADMIN")) return "/admin";
  if (user.roles.includes("RESEARCH_ADMIN")) return "/research";
  if (user.roles.includes("INSTRUCTOR") || user.roles.includes("TA")) return "/faculty";
  return "/home";
}

/** Course ids where the user holds one of the given course roles (active memberships only). */
export function courseIdsWithRole(
  user: Principal,
  roles: readonly CourseRole[] = ANY_MEMBER,
): string[] {
  return user.memberships
    .filter((m) => m.status === "ACTIVE" && roles.includes(m.role))
    .map((m) => m.courseId);
}
