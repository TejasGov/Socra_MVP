import type { Area } from "@/server/auth/rbac";

/**
 * Sidebar navigation per area (PRD §9). Visibility is convenience only; every route authorizes
 * server-side. Icons are referenced by key because server components cannot pass functions to the
 * client sidebar (see ICONS in sidebar-nav.tsx).
 */
export type IconKey =
  | "home"
  | "courses"
  | "practice"
  | "profile"
  | "history"
  | "help"
  | "privacy"
  | "assignments"
  | "analytics"
  | "insights"
  | "materials"
  | "users"
  | "flags"
  | "ai"
  | "usage"
  | "audit"
  | "jobs"
  | "health"
  | "participants"
  | "exports";

export interface ShellNavItem {
  href: string;
  label: string;
  icon?: IconKey;
  /** Only exact-path match marks it active (for area roots like /faculty). */
  exact?: boolean;
}

export interface ShellNavGroup {
  /** Group label, `text-xs` and the only place uppercase is allowed. */
  label?: string;
  items: ShellNavItem[];
}

export const SHELL_NAV: Record<Area, ShellNavGroup[]> = {
  student: [
    {
      items: [
        { href: "/home", label: "Home", icon: "home" },
        { href: "/courses", label: "Courses", icon: "courses", exact: true },
        { href: "/practice", label: "Practice", icon: "practice" },
        { href: "/profile", label: "Learning profile", icon: "profile" },
        { href: "/history", label: "History", icon: "history" },
      ],
    },
    {
      label: "About Socra",
      items: [
        { href: "/how-socra-works", label: "How Socra works", icon: "help" },
        { href: "/privacy", label: "Privacy", icon: "privacy" },
      ],
    },
  ],
  faculty: [
    {
      items: [
        { href: "/faculty", label: "Overview", icon: "home", exact: true },
        { href: "/faculty/assignments", label: "Assignments", icon: "assignments" },
        { href: "/faculty/analytics", label: "Analytics", icon: "analytics" },
        { href: "/faculty/insights", label: "Question insights", icon: "insights" },
        { href: "/faculty/materials", label: "Materials", icon: "materials" },
      ],
    },
  ],
  admin: [
    {
      items: [
        { href: "/admin", label: "Overview", icon: "home", exact: true },
        { href: "/admin/courses", label: "Courses", icon: "courses" },
        { href: "/admin/roster", label: "Roster and roles", icon: "users" },
      ],
    },
    {
      label: "Platform",
      items: [
        { href: "/admin/flags", label: "Feature flags", icon: "flags" },
        { href: "/admin/ai", label: "AI configuration", icon: "ai" },
        { href: "/admin/usage", label: "AI usage", icon: "usage" },
      ],
    },
    {
      label: "Operations",
      items: [
        { href: "/admin/audit", label: "Audit log", icon: "audit" },
        { href: "/admin/jobs", label: "Job failures", icon: "jobs" },
        { href: "/admin/health", label: "System health", icon: "health" },
      ],
    },
  ],
  research: [
    {
      items: [
        { href: "/research", label: "Overview", icon: "home", exact: true },
        { href: "/research/participants", label: "Participants", icon: "participants" },
        { href: "/research/exports", label: "Exports", icon: "exports" },
      ],
    },
  ],
};

/** Pinned primary action at the bottom of the nav, per area (wireframe faculty sidebar). */
export const SHELL_PRIMARY_ACTION: Partial<Record<Area, { href: string; label: string }>> = {
  faculty: { href: "/faculty/assignments/new", label: "Create assignment" },
};

export const AREA_LABELS: Record<Area, string> = {
  student: "Student",
  faculty: "Faculty",
  admin: "Administration",
  research: "Research",
};

export const AREA_HOME: Record<Area, string> = {
  student: "/home",
  faculty: "/faculty",
  admin: "/admin",
  research: "/research",
};
