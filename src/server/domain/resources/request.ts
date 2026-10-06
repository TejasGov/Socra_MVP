import "server-only";
import { z } from "zod";
import { HttpError } from "@/server/http";
import type { IngestResourceInput } from "./ingest";

const RESOURCE_TYPES = [
  "LECTURE_NOTES",
  "SLIDES",
  "READING",
  "EXAMPLE_CODE",
  "LINK",
  "DOCUMENT",
  "OTHER",
] as const;

const fields = z.object({
  courseId: z.string().min(1),
  title: z.string().min(1).max(200),
  type: z.enum(RESOURCE_TYPES).default("LECTURE_NOTES"),
  text: z.string().optional(),
  topicIds: z.array(z.string()).default([]),
  lecture: z.string().max(100).nullish(),
  week: z.coerce.number().int().min(0).max(60).nullish(),
  accessScope: z.enum(["COURSE_ALL", "STAFF_ONLY", "ASSIGNMENT_SCOPED"]).optional(),
});

/** Parse a JSON or multipart request into IngestResourceInput. `fixed` supplies courseId/resourceId for versioning. */
export async function parseResourceRequest(
  req: Request,
  fixed: { courseId?: string; resourceId?: string } = {},
): Promise<IngestResourceInput> {
  const ct = req.headers.get("content-type") ?? "";
  let raw: Record<string, unknown>;
  let file: IngestResourceInput["file"];
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => {
      throw new HttpError(400, "invalid_form", "Could not read the upload.");
    });
    raw = {};
    for (const [k, v] of form.entries()) {
      if (k === "file") continue;
      if (k === "topicIds") {
        const list = (raw.topicIds as string[] | undefined) ?? [];
        list.push(String(v));
        raw.topicIds = list;
      } else if (typeof v === "string" && v !== "") raw[k] = v;
    }
    const f = form.get("file");
    if (f instanceof File && f.size > 0) {
      // Check the declared size before reading the bytes.
      if (f.size > 1_000_000) {
        throw new HttpError(400, "file_too_large", "The file is larger than 1 MB.");
      }
      file = {
        name: f.name,
        size: f.size,
        mimeType: f.type,
        bytes: new Uint8Array(await f.arrayBuffer()),
      };
    }
  } else {
    try {
      raw = (await req.json()) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "invalid_json", "Request body must be JSON or a form upload.");
    }
  }
  if (fixed.courseId) raw.courseId = fixed.courseId;
  const parsed = fields.parse(raw);
  return {
    ...parsed,
    text: parsed.text,
    file,
    lecture: parsed.lecture ?? null,
    week: parsed.week ?? null,
    resourceId: fixed.resourceId,
  };
}
