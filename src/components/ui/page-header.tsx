import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The page's single h1, left-aligned. `meta` is scope or caveat ("CSE 115 · due Oct 9"), never a
 * restatement of the title. Optional back link above, optional actions on the right.
 */
export function PageHeader({
  title,
  meta,
  actions,
  back,
  children,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  children?: ReactNode;
}) {
  return (
    <header className="mb-6 space-y-2">
      {back ? (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg hover:underline"
        >
          <ArrowLeft aria-hidden="true" size={14} strokeWidth={1.75} />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-fg">{title}</h1>
          {meta ? <p className="mt-0.5 text-sm text-fg-muted">{meta}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
}
