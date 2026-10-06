"use client";

import { ChevronsUpDown, LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Disclosure menu at the bottom of the sidebar: name and role, links to other areas the user can
 * access, and sign out (a real form POST to /api/auth/logout, works without JS).
 */
export function UserMenu({
  name,
  email,
  roleLabel,
  areaLinks,
}: {
  name: string;
  email: string;
  roleLabel: string;
  areaLinks: Array<{ href: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    }
    function onPointer(e: PointerEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-fg">{name}</span>
          <span className="block truncate text-xs text-fg-subtle">{roleLabel}</span>
        </span>
        <ChevronsUpDown aria-hidden="true" size={16} strokeWidth={1.75} className="shrink-0 text-fg-subtle" />
      </button>
      {open ? (
        <div
          id={menuId}
          className="absolute right-0 bottom-full left-0 z-40 mb-1 rounded-md border border-border bg-surface py-1 shadow-pop"
        >
          <p className="truncate px-3 py-1.5 text-xs text-fg-subtle" title={email}>
            {email}
          </p>
          {areaLinks.length > 0 ? (
            <div className="border-t border-border py-1">
              {areaLinks.map((a) => (
                <Link
                  key={a.href}
                  href={a.href}
                  onClick={() => setOpen(false)}
                  className="block px-3 py-1.5 text-sm text-fg hover:bg-surface-2"
                >
                  Switch to {a.label.toLowerCase()} view
                </Link>
              ))}
            </div>
          ) : null}
          <form action="/api/auth/logout" method="post" className="border-t border-border pt-1">
            <button
              type="submit"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-fg hover:bg-surface-2"
            >
              <LogOut aria-hidden="true" size={16} strokeWidth={1.75} />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
