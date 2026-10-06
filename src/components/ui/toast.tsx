"use client";

import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Toasts are ONLY for async results that happen off-screen (a background save failed, an export
 * finished) or for undo. Do not toast navigation or saves already visible inline (guardrails S4).
 */
export interface ToastInput {
  title: string;
  message?: string;
  tone?: "error" | "info";
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (t: ToastInput) => {
      const id = next.current++;
      setItems((xs) => [...xs.slice(-2), { ...t, id }]);
      // Errors stay until dismissed; info clears after 8 s.
      if (t.tone !== "error") setTimeout(() => dismiss(id), 8000);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto rounded-md border border-border bg-surface px-3 py-2.5 text-sm shadow-pop"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={t.tone === "error" ? "font-medium text-danger" : "font-medium"}>
                  {t.title}
                </p>
                {t.message ? <p className="text-fg-muted">{t.message}</p> : null}
                {t.action ? (
                  <button
                    type="button"
                    onClick={() => {
                      t.action?.onClick();
                      dismiss(t.id);
                    }}
                    className="mt-1 text-sm font-medium text-accent hover:underline"
                  >
                    {t.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:bg-surface-2"
              >
                <X aria-hidden="true" size={14} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Returns toast(input). Works without a provider (no-op + console.warn) so it never crashes a page. */
export function useToast(): (t: ToastInput) => void {
  const ctx = useContext(ToastContext);
  return (
    ctx ??
    ((t: ToastInput) => {
      console.warn("[toast] no ToastProvider mounted:", t.title);
    })
  );
}
