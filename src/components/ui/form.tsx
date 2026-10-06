import {
  Children,
  cloneElement,
  isValidElement,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";

const control =
  "w-full rounded-sm border border-border-input bg-surface px-2.5 text-sm text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-muted aria-[invalid=true]:border-danger";

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(control, "h-8", className)} {...rest} />;
}

export function Textarea({
  className,
  mono,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }) {
  return (
    <textarea
      className={cx(control, "min-h-20 py-1.5", mono && "font-mono text-code", className)}
      {...rest}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(control, "h-8 pr-7", className)} {...rest}>
      {children}
    </select>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  id: string;
  label: ReactNode;
  help?: ReactNode;
}

/** Checkbox with its label to the right and optional help text below. */
export function Checkbox({ id, label, help, className, ...rest }: CheckboxProps) {
  const helpId = help ? `${id}-help` : undefined;
  return (
    <div className={cx("flex items-start gap-2", className)}>
      <input
        id={id}
        type="checkbox"
        aria-describedby={helpId}
        className="mt-0.5 size-4 shrink-0 accent-accent"
        {...rest}
      />
      <div>
        <label htmlFor={id} className="text-sm text-fg">
          {label}
        </label>
        {help ? (
          <p id={helpId} className="text-xs text-fg-subtle">
            {help}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cx("block text-sm font-medium text-fg", className)} {...rest} />;
}

export interface FieldProps {
  /** id of the control; the single child control receives id, aria-describedby and aria-invalid. */
  id: string;
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactElement;
}

/** Label above, control, help text below, error announced and tied via aria-describedby. */
export function Field({ id, label, help, error, required, className, children }: FieldProps) {
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(" ") || undefined;
  const child = Children.only(children);
  const control = isValidElement<Record<string, unknown>>(child)
    ? cloneElement(child, {
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        required: required || (child.props.required as boolean | undefined),
      })
    : child;
  return (
    <div className={cx("space-y-1", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? <span className="font-normal text-fg-subtle"> (required)</span> : null}
      </Label>
      {control}
      {help ? (
        <p id={helpId} className="text-xs text-fg-subtle">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
