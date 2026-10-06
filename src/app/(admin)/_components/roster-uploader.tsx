"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Badge,
  Button,
  Field,
  Input,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  type BadgeTone,
} from "@/components/ui";

interface PreviewRow {
  rowNumber: number;
  email: string;
  name: string;
  role: string | null;
  sectionCode: string | null;
  status: "VALID" | "DUPLICATE" | "INVALID";
  action: "CREATE_USER" | "ADD_MEMBERSHIP" | "UPDATE_MEMBERSHIP" | "NONE";
  errors: string[];
}
interface Summary {
  total: number;
  create: number;
  addMembership: number;
  update: number;
  duplicate: number;
  invalid: number;
  valid: number;
}
interface Preview {
  importId: string;
  summary: Summary;
  rows: PreviewRow[];
}
interface Applied {
  created: number;
  added: number;
  updated: number;
  skipped: number;
}

const ACTION_LABEL: Record<PreviewRow["action"], string> = {
  CREATE_USER: "Create user and add",
  ADD_MEMBERSHIP: "Add to course",
  UPDATE_MEMBERSHIP: "Update membership",
  NONE: "No change",
};
const STATUS_TONE: Record<PreviewRow["status"], BadgeTone> = {
  VALID: "success",
  DUPLICATE: "warning",
  INVALID: "danger",
};
const STATUS_LABEL: Record<PreviewRow["status"], string> = {
  VALID: "Will apply",
  DUPLICATE: "Duplicate",
  INVALID: "Error",
};

export function RosterUploader({
  courses,
}: {
  courses: Array<{ id: string; code: string; title: string }>;
}) {
  const router = useRouter();
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState<null | "preview" | "apply">(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);

  async function send(url: string, body?: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error(
        (data as { error?: { message?: string } }).error?.message ?? "The request failed.",
      );
    return data;
  }

  return (
    <div className="space-y-4" data-testid="roster-uploader">
      <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
        <Field id="roster-course" label="Course" required>
          <Select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} {c.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          id="roster-file"
          label="CSV file"
          help="Columns: email, name, role (STUDENT, TA, INSTRUCTOR), section, courseCode. courseCode must match the selected course."
          required
        >
          <Input
            type="file"
            accept=".csv,text/csv"
            className="h-auto py-1"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              setPreview(null);
              setApplied(null);
              setError(null);
              if (!file) return;
              setFileName(file.name);
              setCsv(await file.text());
            }}
          />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          loading={busy === "preview"}
          loadingLabel="Checking file"
          disabled={!csv || !courseId}
          data-testid="roster-preview"
          onClick={async () => {
            setBusy("preview");
            setError(null);
            setApplied(null);
            try {
              setPreview(
                (await send("/api/admin/roster/preview", { courseId, fileName, csv })) as Preview,
              );
            } catch (e) {
              setPreview(null);
              setError(e instanceof Error ? e.message : "The request failed.");
            } finally {
              setBusy(null);
            }
          }}
        >
          Preview import
        </Button>
        {error ? (
          <span role="alert" className="text-danger text-sm">
            {error}
          </span>
        ) : null}
      </div>

      {preview ? (
        <section className="space-y-3" aria-label="Import preview">
          <p className="text-fg text-sm" data-testid="roster-summary">
            {preview.summary.total} rows: {preview.summary.create} new users,{" "}
            {preview.summary.addMembership} added to the course, {preview.summary.update} updated,{" "}
            {preview.summary.duplicate} duplicates, {preview.summary.invalid} with errors.
            Duplicates and rows with errors are skipped.
          </p>
          <Table caption="Roster import preview">
            <THead>
              <TR>
                <TH numeric>Row</TH>
                <TH>Email</TH>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH>Section</TH>
                <TH>Result</TH>
                <TH>Action</TH>
                <TH>Notes</TH>
              </TR>
            </THead>
            <TBody>
              {preview.rows.map((r) => (
                <TR key={r.rowNumber}>
                  <TD numeric>{r.rowNumber}</TD>
                  <TD>{r.email}</TD>
                  <TD>{r.name}</TD>
                  <TD>{r.role ?? ""}</TD>
                  <TD>{r.sectionCode ?? ""}</TD>
                  <TD>
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </TD>
                  <TD>{ACTION_LABEL[r.action]}</TD>
                  <TD className="text-fg-muted">{r.errors.join(" ")}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {!applied ? (
            <Button
              variant="primary"
              loading={busy === "apply"}
              loadingLabel="Applying"
              disabled={preview.summary.valid === 0}
              data-testid="roster-apply"
              onClick={async () => {
                setBusy("apply");
                setError(null);
                try {
                  setApplied(
                    (await send(`/api/admin/roster/imports/${preview.importId}`)) as Applied,
                  );
                  router.refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : "The request failed.");
                } finally {
                  setBusy(null);
                }
              }}
            >
              Apply {preview.summary.valid} changes
            </Button>
          ) : null}
        </section>
      ) : null}

      {applied ? (
        <p role="status" className="text-success text-sm" data-testid="roster-applied">
          Import applied: {applied.created} users created, {applied.added} added, {applied.updated}{" "}
          updated, {applied.skipped} skipped. The report is in the import history below.
        </p>
      ) : null}
    </div>
  );
}
