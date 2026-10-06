import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { DevBadge, LinkButton } from "@/components/ui";
import { primaryRoleLabel } from "@/lib/navigation";
import { requireArea } from "@/server/auth/current-user";
import { canAccessArea, type Area } from "@/server/auth/rbac";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { recentSocraSessions } from "../(student)/_lib/student-data";
import { CourseSwitcher } from "./course-switcher";
import { AREA_HOME, AREA_LABELS, SHELL_NAV, SHELL_PRIMARY_ACTION } from "./nav";
import { CourseLinks, SidebarNav } from "./sidebar-nav";
import { ShellFrame } from "./shell-frame";
import { UserMenu } from "./user-menu";

const AREA_ORDER: Area[] = ["student", "faculty", "admin", "research"];

/**
 * Trivial read (Agent F, shell only): code/title of the courses the user holds an active membership
 * in, for the sidebar course list. Course data access is otherwise owned by domain modules.
 */
async function shellCourses(courseIds: string[]) {
  if (courseIds.length === 0) return [];
  return prisma.course.findMany({
    where: { id: { in: courseIds }, isActive: true, archivedAt: null },
    select: { id: true, code: true, title: true },
    orderBy: { code: "asc" },
  });
}

/**
 * Server-side area layout: authorizes the area, then renders the sidebar shell (PRD §9).
 * `nav` is accepted for backward compatibility and ignored; navigation lives in ./nav.ts.
 */
export async function AreaShell({
  area,
  children,
}: {
  area: Area;
  nav?: unknown;
  children: ReactNode;
}) {
  const user = await requireArea(area);
  const mock = env().AI_MOCK_MODE;

  const courseRoles = area === "faculty" ? ["INSTRUCTOR", "TA"] : area === "student" ? ["STUDENT"] : [];
  const courses =
    courseRoles.length > 0
      ? await shellCourses(
          user.memberships.filter((m) => courseRoles.includes(m.role)).map((m) => m.courseId),
        )
      : [];

  const recent =
    area === "student"
      ? (await recentSocraSessions(user, 8))
          .filter((r, i, all) => r.href !== null && all.findIndex((x) => x.href === r.href) === i)
          .slice(0, 4)
      : [];

  const areaLinks = AREA_ORDER.filter((a) => a !== area && canAccessArea(user, a))
    .filter((a) => a !== "student" || user.memberships.some((m) => m.role === "STUDENT"))
    .map((a) => ({ href: AREA_HOME[a], label: AREA_LABELS[a] }));

  const primary = SHELL_PRIMARY_ACTION[area];
  const areaLabel = AREA_LABELS[area];

  const sidebar = (
    <div className="flex h-full flex-col gap-5 px-3 py-4">
      <div className="flex items-baseline justify-between gap-2 px-2">
        <Link href={AREA_HOME[area]} className="text-base font-semibold text-fg">
          Socra
        </Link>
        {area !== "student" ? <span className="text-xs text-fg-subtle">{areaLabel}</span> : null}
      </div>

      {area === "faculty" ? (
        <Suspense fallback={null}>
          <CourseSwitcher courses={courses} />
        </Suspense>
      ) : null}

      <div className="flex-1 space-y-5 overflow-y-auto">
        <SidebarNav groups={SHELL_NAV[area]} label={`${areaLabel} navigation`} />
        {area === "student" ? <CourseLinks courses={courses} /> : null}
        {recent.length > 0 ? (
          <SidebarNav
            label="Recent Socra sessions"
            groups={[
              {
                label: "Recent",
                items: recent.map((r) => ({ href: r.href!, label: r.title, exact: true })),
              },
            ]}
          />
        ) : null}
      </div>

      {primary ? (
        <LinkButton href={primary.href} variant="secondary" className="w-full">
          {primary.label}
        </LinkButton>
      ) : null}

      <div className="space-y-2 border-t border-border pt-3">
        {mock ? (
          <div className="px-2">
            <DevBadge />
          </div>
        ) : null}
        <UserMenu
          name={user.name}
          email={user.email}
          roleLabel={primaryRoleLabel(user.roles)}
          areaLinks={areaLinks}
        />
      </div>
    </div>
  );

  return (
    <ShellFrame sidebar={sidebar} topBarLabel={area === "student" ? "Socra" : `Socra ${areaLabel}`}>
      {children}
    </ShellFrame>
  );
}
