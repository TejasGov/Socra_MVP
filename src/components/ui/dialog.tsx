"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cx } from "./cx";

/**
 * Modal dialog on the native <dialog> element (showModal makes the rest of the page inert, so focus
 * is trapped). Escape closes, focus returns to the element that opened it, labelled by its title.
 * Use only for destructive confirmations, publish confirmation, and short focused tasks.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Action buttons, right-aligned. Put the confirming action last. */
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleClose = () => {
      returnFocus.current?.focus?.();
      returnFocus.current = null;
    };
    el.addEventListener("close", handleClose);
    return () => el.removeEventListener("close", handleClose);
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Click on the scrim (the dialog element itself, outside the panel) closes.
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        "m-auto w-full max-w-md rounded-lg border border-border bg-surface p-0 text-fg shadow-pop backdrop:bg-fg/30",
        className,
      )}
    >
      {open ? (
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="text-base font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="-mt-1 -mr-1 inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-2 hover:text-fg"
            >
              <X aria-hidden="true" size={16} strokeWidth={1.75} />
            </button>
          </div>
          {description ? (
            <p id={descId} className="mt-1 text-sm text-fg-muted">
              {description}
            </p>
          ) : null}
          {children ? <div className="mt-4 text-sm">{children}</div> : null}
          {footer ? <div className="mt-5 flex justify-end gap-2">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
