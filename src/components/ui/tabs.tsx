"use client";

import Link from "next/link";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export interface TabItem {
  id: string;
  label: ReactNode;
  content: ReactNode;
}

/**
 * In-page tabs (WAI-ARIA tabs pattern): arrow keys / Home / End move between tabs, one accent
 * underline marks the selected tab. For route-based tabs use <TabLinks>.
 */
export function Tabs({
  items,
  defaultId,
  label,
  onChange,
  className,
}: {
  items: TabItem[];
  defaultId?: string;
  /** Accessible name for the tablist. */
  label: string;
  onChange?: (id: string) => void;
  className?: string;
}) {
  const [active, setActive] = useState(defaultId ?? items[0]?.id);
  const base = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function select(i: number) {
    const item = items[i];
    if (!item) return;
    setActive(item.id);
    onChange?.(item.id);
    refs.current[i]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = items.findIndex((t) => t.id === active);
    if (e.key === "ArrowRight") select((i + 1) % items.length);
    else if (e.key === "ArrowLeft") select((i - 1 + items.length) % items.length);
    else if (e.key === "Home") select(0);
    else if (e.key === "End") select(items.length - 1);
    else return;
    e.preventDefault();
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
        className="flex gap-4 border-b border-border"
      >
        {items.map((t, i) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(i)}
              className={cx(
                "-mb-px h-9 border-b-2 px-0.5 text-sm font-medium",
                selected
                  ? "border-accent text-fg"
                  : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {items.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={t.id !== active}
          tabIndex={0}
          className="pt-4 focus-visible:outline-offset-4"
        >
          {t.id === active ? t.content : null}
        </div>
      ))}
    </div>
  );
}

/** Route-based tab row (each tab is a link). Mark the current one with `active`. */
export function TabLinks({
  items,
  label,
  className,
}: {
  items: Array<{ href: string; label: ReactNode; active?: boolean }>;
  label: string;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cx("flex gap-4 border-b border-border", className)}>
      {items.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.active ? "page" : undefined}
          className={cx(
            "-mb-px inline-flex h-9 items-center border-b-2 px-0.5 text-sm font-medium",
            t.active ? "border-accent text-fg" : "border-transparent text-fg-muted hover:text-fg",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
