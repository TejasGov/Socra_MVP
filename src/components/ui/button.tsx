import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps, ReactNode, Ref } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border border-border-strong bg-surface text-fg hover:bg-surface-2",
  ghost: "text-fg hover:bg-surface-2",
  danger: "border border-border-strong bg-surface text-danger hover:bg-danger-bg",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2 text-xs",
  md: "h-8 px-3 text-sm",
  lg: "h-9 px-4 text-sm",
};

export function buttonClasses(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cx(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the button, sets aria-busy, and shows `loadingLabel` (or the children). */
  loading?: boolean;
  loadingLabel?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
  icon?: ReactNode;
}

/** Button. Labels are verb + object ("Submit stage 2"), never bare "Submit". */
export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  loadingLabel,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {icon && !loading ? (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      ) : null}
      {loading ? (loadingLabel ?? children) : children}
    </button>
  );
}

export interface LinkButtonProps extends ComponentProps<typeof Link> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

/** A next/link styled as a button, for navigation actions. */
export function LinkButton({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...rest}>
      {icon ? (
        <span aria-hidden="true" className="inline-flex">
          {icon}
        </span>
      ) : null}
      {children}
    </Link>
  );
}

/** Inline text link in the accent color. */
export function TextLink({ className, ...rest }: ComponentProps<typeof Link>) {
  return (
    <Link className={cx("text-accent underline-offset-2 hover:underline", className)} {...rest} />
  );
}
