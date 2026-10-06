import type { ReactNode } from "react";

/** Placeholder content for routes whose feature UI is built by later agents. */
export function PagePlaceholder({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <section aria-labelledby="page-title" className="max-w-3xl">
      <h1 id="page-title" className="text-xl font-semibold">
        {title}
      </h1>
      {description ? <p className="mt-2 text-gray-700">{description}</p> : null}
      {children}
    </section>
  );
}
