"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Checkbox, Field, Input, Select } from "@/components/ui";

export interface AllowlistField {
  key: string;
  label: string;
  type: string;
  group: string;
  privacy: string;
}

const GROUP_LABEL: Record<string, string> = {
  identity: "Identity (pseudonymous)",
  context: "Context",
  versions: "Versions",
  outcome: "Outcomes",
  ai: "AI behaviour",
  operational: "Operational",
};

interface Result {
  exportId: string;
  queued: boolean;
  rowCount: number | null;
}

export function ExportForm({
  allowlist,
  defaults,
  courses,
  assignments,
}: {
  allowlist: AllowlistField[];
  defaults: string[];
  courses: Array<{ id: string; code: string }>;
  assignments: Array<{ id: string; title: string; courseCode: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const groups = [...new Set(allowlist.map((f) => f.group))];

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      fields: form.getAll("fields").map(String),
      format: String(form.get("format")),
    };
    for (const k of ["courseId", "assignmentId"]) {
      const v = String(form.get(k) ?? "");
      if (v) body[k] = v;
    }
    for (const k of ["from", "to"]) {
      const v = String(form.get(k) ?? "");
      if (v) body[k] = new Date(v).toISOString();
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/research/exports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      } & Result;
      if (!res.ok) {
        setError(data.error?.message ?? "The export failed.");
        return;
      }
      setResult(data);
      router.refresh();
    } catch {
      setError("Could not reach the server. No export was created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" data-testid="export-form">
      <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
        <Field
          id="exp-course"
          label="Course"
          help="All courses includes every course with participants."
        >
          <Select name="courseId" defaultValue="">
            <option value="">All courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="exp-assignment" label="Assignment">
          <Select name="assignmentId" defaultValue="">
            <option value="">All assignments</option>
            {assignments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.courseCode}: {a.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="exp-from" label="From">
          <Input name="from" type="date" />
        </Field>
        <Field id="exp-to" label="Until (exclusive)">
          <Input name="to" type="date" />
        </Field>
        <Field id="exp-format" label="Format" required>
          <Select name="format" defaultValue="CSV">
            <option value="CSV">CSV</option>
            <option value="JSON">JSON</option>
          </Select>
        </Field>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-fg text-sm font-semibold">Fields</h3>
          <p className="text-fg-subtle text-xs">
            Only these fields can be exported. Unless noted, a field carries no personal data. Names, emails, internal user ids and raw message or
            code content are never available. Rows are one per event for participants who have not
            declined or withdrawn.
          </p>
        </div>
        {groups.map((g) => (
          <fieldset key={g} className="space-y-1.5">
            <legend className="text-fg-muted text-sm font-medium">{GROUP_LABEL[g] ?? g}</legend>
            <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {allowlist
                .filter((f) => f.group === g)
                .map((f) => (
                  <Checkbox
                    key={f.key}
                    id={`field-${f.key}`}
                    name="fields"
                    value={f.key}
                    label={f.label}
                    help={f.privacy === "No personal data." ? undefined : f.privacy}
                    defaultChecked={defaults.includes(f.key)}
                  />
                ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          loadingLabel="Creating export"
          data-testid="export-create"
        >
          Create export
        </Button>
        {error ? (
          <span role="alert" className="text-danger text-sm">
            {error}
          </span>
        ) : null}
      </div>
      {result ? (
        <p role="status" className="text-success text-sm" data-testid="export-result">
          {result.queued ? (
            "Export queued. Large exports are built by the worker; refresh the list below to see when it is ready."
          ) : (
            <>
              Export ready with {result.rowCount} rows.{" "}
              <a
                className="text-accent underline"
                href={`/api/research/exports/${result.exportId}/download`}
              >
                Download file
              </a>
            </>
          )}
        </p>
      ) : null}
    </form>
  );
}
