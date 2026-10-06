/** Role display helpers for the shell. Navigation itself lives in src/app/_shell/nav.ts. */

const ROLE_LABELS: Record<string, string> = {
  SYSTEM_ADMIN: "System admin",
  RESEARCH_ADMIN: "Research admin",
  INSTRUCTOR: "Instructor",
  TA: "Teaching assistant",
  STUDENT: "Student",
};

const ROLE_ORDER = ["SYSTEM_ADMIN", "RESEARCH_ADMIN", "INSTRUCTOR", "TA", "STUDENT"];

export function primaryRoleLabel(roles: readonly string[]): string {
  const top = ROLE_ORDER.find((r) => roles.includes(r));
  return top ? (ROLE_LABELS[top] ?? top) : "User";
}
