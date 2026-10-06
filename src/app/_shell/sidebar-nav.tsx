"use client";

import {
  Activity,
  BookOpen,
  ChartBar,
  CircleHelp,
  ClipboardList,
  Cpu,
  Download,
  FileQuestion,
  Flag,
  FolderOpen,
  History,
  House,
  Layers,
  ListChecks,
  Receipt,
  ScrollText,
  ShieldCheck,
  TriangleAlert,
  Users,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui/cx";
import type { IconKey, ShellNavGroup } from "./nav";

const ICONS: Record<IconKey, LucideIcon> = {
  home: House,
  courses: BookOpen,
  practice: ListChecks,
  profile: Layers,
  history: History,
  help: CircleHelp,
  privacy: ShieldCheck,
  assignments: ClipboardList,
  analytics: ChartBar,
  insights: FileQuestion,
  materials: FolderOpen,
  users: Users,
  flags: Flag,
  ai: Cpu,
  usage: Receipt,
  audit: ScrollText,
  jobs: TriangleAlert,
  health: Activity,
  participants: Users,
  exports: Download,
};

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const itemClass = (active: boolean) =>
  cx(
    "flex h-8 items-center gap-2 rounded-md px-2 text-sm",
    active
      ? "bg-accent-subtle font-medium text-accent"
      : "text-fg-muted hover:bg-surface hover:text-fg",
  );

/** Nav groups with the active item marked (accent-subtle bg + accent text, aria-current). */
export function SidebarNav({ groups, label }: { groups: ShellNavGroup[]; label: string }) {
  const pathname = usePathname() ?? "";
  // Pick the most specific matching href so /faculty/assignments/new doesn't also light up its parent twice.
  const allHrefs = groups.flatMap((g) => g.items).filter((i) => isActive(pathname, i.href, i.exact));
  const activeHref = allHrefs.sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label={label} className="space-y-5">
      {groups.map((group, gi) => (
        <div key={group.label ?? gi}>
          {group.label ? (
            <p className="mb-1 px-2 text-xs font-medium tracking-wide text-fg-subtle uppercase">
              {group.label}
            </p>
          ) : null}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = item.href === activeHref;
              const Icon = item.icon ? ICONS[item.icon] : null;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={itemClass(active)}
                  >
                    {Icon ? (
                      <Icon aria-hidden="true" size={18} strokeWidth={1.75} className="shrink-0" />
                    ) : null}
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Student course list in the sidebar: each enrolled course is a link (acts as the course switcher). */
export function CourseLinks({
  courses,
}: {
  courses: Array<{ id: string; code: string; title: string }>;
}) {
  const pathname = usePathname() ?? "";
  if (courses.length === 0) return null;
  return (
    <div>
      <p className="mb-1 px-2 text-xs font-medium tracking-wide text-fg-subtle uppercase">
        My courses
      </p>
      <ul className="space-y-0.5">
        {courses.map((c) => {
          const href = `/courses/${c.id}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={c.id}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                title={`${c.code} ${c.title}`}
                className={itemClass(active)}
              >
                <span className="shrink-0 font-medium tabular-nums">{c.code}</span>
                <span className="truncate text-xs text-fg-subtle">{c.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
