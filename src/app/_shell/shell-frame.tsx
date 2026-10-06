"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/**
 * Layout frame: 232px sidebar (surface-2, right border) + main content. Below `lg` the sidebar
 * collapses behind a "Menu" button in a top bar.
 */
export function ShellFrame({
  sidebar,
  topBarLabel,
  children,
}: {
  sidebar: ReactNode;
  topBarLabel: ReactNode;
  children: ReactNode;
}) {
  // The mobile menu is open only for the path it was opened on, so navigating closes it.
  const pathname = usePathname() ?? "";
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;

  return (
    <div className="min-h-screen lg:flex">
      <div className="flex h-12 items-center justify-between border-b border-border bg-surface-2 px-4 lg:hidden">
        <span className="text-sm font-semibold text-fg">{topBarLabel}</span>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="shell-sidebar"
          onClick={() => setOpenOn(open ? null : pathname)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-fg hover:bg-surface"
        >
          {open ? (
            <X aria-hidden="true" size={18} strokeWidth={1.75} />
          ) : (
            <Menu aria-hidden="true" size={18} strokeWidth={1.75} />
          )}
          Menu
        </button>
      </div>
      <aside
        id="shell-sidebar"
        className={cx(
          "flex-col border-border bg-surface-2 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[232px] lg:shrink-0 lg:border-r",
          open ? "flex border-b" : "hidden",
        )}
      >
        {sidebar}
      </aside>
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
        {/* Pages that need the full width (workspace with a right Socra panel) render a descendant with
            data-shell-width="full" and this cap is lifted. */}
        <div className="mx-auto max-w-[1200px] px-6 py-6 has-[[data-shell-width=full]]:max-w-none lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
