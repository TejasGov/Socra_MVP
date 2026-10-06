"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  Button,
  Checkbox,
  Field,
  Input,
  Select,
  Textarea,
  type ButtonVariant,
} from "@/components/ui";

export type FieldDef = {
  name: string;
  label: string;
  type?:
    | "text"
    | "email"
    | "number"
    | "datetime-local"
    | "date"
    | "textarea"
    | "select"
    | "checkboxes"
    | "checkbox";
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
  help?: string;
  placeholder?: string;
  defaultValue?: string | number | boolean | string[];
  step?: string;
};

export interface JsonFormProps {
  url: string;
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  fields: FieldDef[];
  submitLabel: string;
  /** Extra constant body values (ids). */
  hidden?: Record<string, unknown>;
  variant?: ButtonVariant;
  testId?: string;
  successMessage?: string;
  /** Layout: inline puts the fields in a wrapping row. */
  inline?: boolean;
  /** Ask the browser to confirm before sending. */
  confirm?: string;
}

function buildBody(fields: FieldDef[], form: FormData, hidden: Record<string, unknown> = {}) {
  const body: Record<string, unknown> = { ...hidden };
  for (const f of fields) {
    if (f.type === "checkboxes") {
      body[f.name] = form.getAll(f.name).map(String);
      continue;
    }
    if (f.type === "checkbox") {
      body[f.name] = form.get(f.name) === "on";
      continue;
    }
    const raw = form.get(f.name);
    if (raw === null || String(raw).trim() === "") continue;
    const value = String(raw);
    if (f.type === "number") body[f.name] = Number(value);
    else if (f.type === "datetime-local" || f.type === "date")
      body[f.name] = new Date(value).toISOString();
    else if (value === "true" || value === "false") body[f.name] = value === "true";
    else body[f.name] = value;
  }
  return body;
}

/** Small generic form that sends JSON to an admin or research API route and refreshes the page. */
export function JsonForm({
  url,
  method = "POST",
  fields,
  submitLabel,
  hidden,
  variant = "secondary",
  testId,
  successMessage = "Saved.",
  inline = false,
  confirm,
}: JsonFormProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const uid = `jf-${testId ?? url.replace(/\W+/g, "-")}-${JSON.stringify(hidden ?? {}).length}`;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    setBusy(true);
    setError(null);
    setDone(null);
    setFieldErrors({});
    try {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildBody(fields, new FormData(e.currentTarget), hidden)),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: {
          message?: string;
          details?: Array<{ path: Array<string | number>; message: string }>;
        };
      };
      if (!res.ok) {
        const details = Array.isArray(data.error?.details) ? data.error!.details! : [];
        const fe: Record<string, string> = {};
        for (const d of details) {
          if (d && Array.isArray(d.path) && d.path[0] !== undefined)
            fe[String(d.path[0])] = d.message;
        }
        setFieldErrors(fe);
        setError(
          Object.keys(fe).length
            ? "Fix the highlighted fields."
            : (data.error?.message ?? "The request failed."),
        );
        return;
      }
      setDone(successMessage);
      router.refresh();
    } catch {
      setError("Could not reach the server. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      data-testid={testId}
      className={inline ? "flex flex-wrap items-end gap-3" : "space-y-3"}
    >
      {fields.map((f) => {
        const id = `${uid}-${f.name}`;
        const err = fieldErrors[f.name];
        if (f.type === "checkbox") {
          return (
            <Checkbox
              key={f.name}
              id={id}
              name={f.name}
              label={f.label}
              help={f.help}
              defaultChecked={f.defaultValue === true}
            />
          );
        }
        if (f.type === "checkboxes") {
          return (
            <fieldset key={f.name} className="space-y-1.5">
              <legend className="text-fg text-sm font-medium">{f.label}</legend>
              {(f.options ?? []).map((o) => (
                <Checkbox
                  key={o.value}
                  id={`${id}-${o.value}`}
                  name={f.name}
                  value={o.value}
                  label={o.label}
                  defaultChecked={Array.isArray(f.defaultValue) && f.defaultValue.includes(o.value)}
                />
              ))}
              {err ? (
                <p role="alert" className="text-danger text-xs">
                  {err}
                </p>
              ) : null}
            </fieldset>
          );
        }
        return (
          <Field
            key={f.name}
            id={id}
            label={f.label}
            help={f.help}
            error={err}
            required={f.required}
          >
            {f.type === "textarea" ? (
              <Textarea
                name={f.name}
                placeholder={f.placeholder}
                defaultValue={String(f.defaultValue ?? "")}
              />
            ) : f.type === "select" ? (
              <Select name={f.name} defaultValue={String(f.defaultValue ?? "")}>
                {(f.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                name={f.name}
                type={f.type ?? "text"}
                step={f.step}
                placeholder={f.placeholder}
                defaultValue={f.defaultValue === undefined ? undefined : String(f.defaultValue)}
              />
            )}
          </Field>
        );
      })}
      <div className="flex items-center gap-3">
        <Button type="submit" variant={variant} loading={busy} loadingLabel="Saving">
          {submitLabel}
        </Button>
        {error ? (
          <span role="alert" className="text-danger text-sm">
            {error}
          </span>
        ) : null}
        {done ? (
          <span role="status" className="text-success text-sm">
            {done}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** One-click action (retry, resolve, remove) with the same error handling. */
export function ActionButton({
  url,
  method = "POST",
  body,
  label,
  variant = "secondary",
  size = "sm",
  confirm,
  testId,
}: {
  url: string;
  method?: "POST" | "PUT" | "DELETE";
  body?: unknown;
  label: string;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  confirm?: string;
  testId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant={variant}
        size={size}
        loading={busy}
        data-testid={testId}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(url, {
              method,
              headers: { "content-type": "application/json" },
              body: body === undefined ? undefined : JSON.stringify(body),
            });
            if (!res.ok) {
              const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
              setError(data.error?.message ?? "The request failed.");
              return;
            }
            router.refresh();
          } catch {
            setError("Could not reach the server.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {label}
      </Button>
      {error ? (
        <span role="alert" className="text-danger text-xs">
          {error}
        </span>
      ) : null}
    </span>
  );
}
