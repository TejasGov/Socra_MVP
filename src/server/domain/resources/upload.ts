/** Upload validation (pure). V1 accepts plain text and markdown only. */

export const MAX_RESOURCE_BYTES = 1_000_000; // 1 MB
export const MAX_RESOURCE_CHARS = 500_000;
export const ALLOWED_EXTENSIONS = [".txt", ".md", ".markdown"] as const;
const ALLOWED_MIME = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/octet-stream",
  "",
]);

export class ResourceValidationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ResourceValidationError";
  }
}

export interface UploadMeta {
  name: string;
  size: number;
  mimeType?: string | null;
}

export function validateUpload(meta: UploadMeta): { mimeType: string } {
  const lower = meta.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    throw new ResourceValidationError(
      "unsupported_file_type",
      "Only .txt and .md files are supported right now. PDF, slides and Word files are not accepted yet, so paste the text instead.",
    );
  }
  const mime = (meta.mimeType ?? "").split(";")[0]!.trim().toLowerCase();
  if (!ALLOWED_MIME.has(mime)) {
    throw new ResourceValidationError(
      "unsupported_mime_type",
      `The file type "${mime}" is not supported. Upload a .txt or .md file.`,
    );
  }
  if (meta.size <= 0) throw new ResourceValidationError("empty_file", "The file is empty.");
  if (meta.size > MAX_RESOURCE_BYTES) {
    throw new ResourceValidationError(
      "file_too_large",
      `The file is ${(meta.size / 1_000_000).toFixed(1)} MB. The limit is ${MAX_RESOURCE_BYTES / 1_000_000} MB.`,
    );
  }
  return {
    mimeType: lower.endsWith(".md") || lower.endsWith(".markdown") ? "text/markdown" : "text/plain",
  };
}

/** Decode bytes as UTF-8 and reject binary content (NUL bytes / many replacement characters). */
export function decodeTextBytes(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/^﻿/, "");
  if (text.includes("\u0000") || (text.match(/�/g)?.length ?? 0) > 3) {
    throw new ResourceValidationError(
      "not_text",
      "The file does not look like text. Upload a UTF-8 .txt or .md file.",
    );
  }
  return text;
}

export function validateText(text: string): string {
  const t = text.replace(/\r\n?/g, "\n").trim();
  if (!t) throw new ResourceValidationError("empty_text", "There is no text to index.");
  if (t.length > MAX_RESOURCE_CHARS) {
    throw new ResourceValidationError(
      "text_too_long",
      `The text is ${t.length.toLocaleString("en-US")} characters. The limit is ${MAX_RESOURCE_CHARS.toLocaleString("en-US")}.`,
    );
  }
  return t;
}
