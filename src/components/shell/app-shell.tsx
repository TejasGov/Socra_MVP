import Link from "next/link";
import type { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export interface ShellUser {
  name: string;
  email: string;
  roleLabel: string;
}

export interface AppShellProps {
  areaLabel: string;
  nav: NavSection[];
  user: ShellUser;
  /** Links to other areas this user may access (e.g. Faculty, Admin). */
  areaLinks?: NavItem[];
  children: ReactNode;
}

/**
 * Minimal role-aware application shell (semantic structure only; styling comes from the design system later).
 */
export function AppShell({ areaLabel, nav, user, areaLinks = [], children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href="/" className="font-semibold">
            Socra
          </Link>
          <span className="text-sm text-gray-600">{areaLabel}</span>
          {areaLinks.length > 0 ? (
            <nav aria-label="Areas" className="flex gap-3 text-sm">
              {areaLinks.map((a) => (
                <Link key={a.href} href={a.href} className="underline-offset-2 hover:underline">
                  {a.label}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span>
            <span className="font-medium">{user.name}</span>{" "}
            <span className="text-gray-600">({user.roleLabel})</span>
          </span>
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>
      <div className="flex flex-1">
        <nav
          aria-label={`${areaLabel} navigation`}
          className="w-56 shrink-0 border-r border-gray-200 p-3 text-sm"
        >
          {nav.map((section, i) => (
            <div key={section.label ?? i} className="mb-4">
              {section.label ? (
                <p className="mb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">
                  {section.label}
                </p>
              ) : null}
              <ul className="space-y-1">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="block rounded px-2 py-1 hover:bg-gray-100">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <main id="main" className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
