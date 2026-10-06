import type {
  HTMLAttributes,
  ReactNode,
  TableHTMLAttributes,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { cx } from "./cx";

/** Semantic table in a 1px bordered container; scrolls horizontally on narrow screens. */
export function Table({
  className,
  caption,
  children,
  ...rest
}: TableHTMLAttributes<HTMLTableElement> & { caption?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className={cx("w-full border-collapse text-left text-sm", className)} {...rest}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cx("bg-surface-2", className)} {...rest} />;
}

export function TBody(props: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function TR({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cx("border-b border-border last:border-b-0 hover:bg-surface-2", className)}
      {...rest}
    />
  );
}

/** Header cell. Uppercase is allowed here (table column headers) per guardrails V12. */
export function TH({
  className,
  numeric,
  scope = "col",
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope={scope}
      className={cx(
        "h-8 border-b border-border px-3 text-xs font-medium tracking-wide whitespace-nowrap text-fg-muted uppercase",
        numeric ? "text-right" : "text-left",
        className,
      )}
      {...rest}
    />
  );
}

/** Body cell. `numeric` right-aligns with tabular-nums. */
export function TD({
  className,
  numeric,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cx(
        "h-10 px-3 py-2 align-middle text-fg",
        numeric && "text-right tabular-nums",
        className,
      )}
      {...rest}
    />
  );
}
