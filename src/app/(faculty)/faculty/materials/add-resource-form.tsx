"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";

const TYPES = [
  ["LECTURE_NOTES", "Lecture notes"],
  ["READING", "Reading"],
  ["EXAMPLE_CODE", "Example code"],
  ["DOCUMENT", "Document"],
  ["OTHER", "Other"],
] as const;

export function AddResourceForm({
  courseId,
  topics,
  existing,
}: {
  courseId: string;
  topics: Array<{ id: string; name: string }>;
  existing: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setDone(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    const text = String(data.get("text") ?? "").trim();
    if (!(file instanceof File && file.size > 0) && !text) {
      setError("Paste text or choose a .md or .txt file.");
      return;
    }
    if (file instanceof File && file.size > 0 && text) data.delete("text");
    if (!(file instanceof File && file.size > 0)) data.delete("file");
    const versionOf = String(data.get("versionOf") ?? "");
    data.delete("versionOf");
    data.set("courseId", courseId);

    setBusy(true);
    try {
      const res = await fetch(versionOf ? `/api/resources/${versionOf}` : "/api/resources", {
        method: versionOf ? "PUT" : "POST",
        body: data,
      });
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
        chunkCount?: number;
        version?: number;
      } | null;
      if (!res.ok) {
        setError(body?.error?.message ?? "The resource could not be added.");
        return;
      }
      setDone(`Indexed ${body?.chunkCount ?? 0} sections as version ${body?.version ?? 1}.`);
      form.reset();
      router.refresh();
    } catch {
      setError("Could not reach the server. Nothing was saved. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" data-testid="add-resource-form">
      <Field id="res-title" label="Title" required>
        <Input name="title" maxLength={200} required />
      </Field>
      <Field id="res-version" label="Replace an existing resource" help="Leave as new to add a separate resource. Replacing keeps one entry and bumps its version.">
        <Select name="versionOf" defaultValue="">
          <option value="">New resource</option>
          {existing.map((r) => (
            <option key={r.id} value={r.id}>
              New version of {r.title}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="res-type" label="Type">
          <Select name="type" defaultValue="LECTURE_NOTES">
            {TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="res-scope" label="Visible to">
          <Select name="accessScope" defaultValue="COURSE_ALL">
            <option value="COURSE_ALL">All students</option>
            <option value="STAFF_ONLY">Staff only</option>
            <option value="ASSIGNMENT_SCOPED">Selected assignments</option>
          </Select>
        </Field>
        <Field id="res-lecture" label="Lecture">
          <Input name="lecture" maxLength={100} placeholder="Lecture 7" />
        </Field>
        <Field id="res-week" label="Week">
          <Input name="week" type="number" min={0} max={60} />
        </Field>
      </div>
      {topics.length ? (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Topics</legend>
          <div className="max-h-32 space-y-1 overflow-y-auto rounded-sm border border-border p-2">
            {topics.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="topicIds" value={t.id} />
                {t.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <Field id="res-text" label="Paste text" help="Markdown headings become section titles in citations.">
        <Textarea name="text" rows={8} mono />
      </Field>
      <Field id="res-file" label="Or upload a file" help=".md or .txt only">
        <Input name="file" type="file" accept=".md,.markdown,.txt,text/plain,text/markdown" />
      </Field>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-sm text-success">
          {done}
        </p>
      ) : null}
      <Button type="submit" variant="primary" loading={busy} loadingLabel="Indexing resource" data-testid="add-resource-submit">
        Add resource
      </Button>
    </form>
  );
}
