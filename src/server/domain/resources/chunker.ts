/**
 * Deterministic text chunker for course resources (TASK §14).
 *
 * - Splits on markdown headings (`#`..`######`) and on setext/underlined headings is NOT supported (V1: txt/md).
 * - Within a section, paragraphs are packed up to ~`targetChars`; oversized paragraphs are split at sentence
 *   boundaries (then hard-wrapped at whitespace).
 * - The section title (heading path, e.g. "Recursion > Base cases") travels with every chunk for citations.
 * - Consecutive chunks of the same section overlap by ~`overlapChars` so a concept spanning a boundary stays findable.
 *
 * Pure: no I/O, no server-only imports (unit-testable).
 */

export interface TextChunk {
  chunkIndex: number;
  content: string;
  /** "H1 > H2 > H3" path of the nearest headings; null when the text has no headings before this chunk. */
  headingPath: string | null;
  tokenCount: number;
}

export interface ChunkOptions {
  targetChars?: number;
  overlapChars?: number;
  /** Fallback section title (e.g. the resource title) used when no heading precedes the text. */
  defaultHeading?: string | null;
}

export const DEFAULT_CHUNK_CHARS = 800;
export const DEFAULT_OVERLAP_CHARS = 120;

interface Section {
  headingPath: string | null;
  body: string;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Split markdown/plain text into sections keyed by their heading path (fenced code blocks are never treated as headings). */
export function splitSections(text: string, defaultHeading: string | null = null): Section[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sections: Section[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  let current: string[] = [];
  let currentPath: string | null = defaultHeading;
  let inFence = false;

  const flush = () => {
    const body = current.join("\n").trim();
    if (body) sections.push({ headingPath: currentPath, body });
    current = [];
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = inFence ? null : HEADING_RE.exec(line);
    if (m) {
      flush();
      const level = m[1]!.length;
      while (stack.length && stack[stack.length - 1]!.level >= level) stack.pop();
      stack.push({ level, title: m[2]!.trim() });
      currentPath = stack.map((s) => s.title).join(" > ");
    } else {
      current.push(line);
    }
  }
  flush();
  return sections;
}

function splitLong(paragraph: string, target: number): string[] {
  if (paragraph.length <= target) return [paragraph];
  const sentences = paragraph.match(/[^.!?\n]+[.!?]+(?:\s+|$)|[^.!?\n]+$/g) ?? [paragraph];
  const out: string[] = [];
  let buf = "";
  const push = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  };
  for (const s of sentences) {
    if (s.length > target) {
      push();
      // hard wrap at whitespace
      let rest = s.trim();
      while (rest.length > target) {
        let cut = rest.lastIndexOf(" ", target);
        if (cut < target * 0.5) cut = target;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      buf = rest ? rest + " " : "";
    } else if ((buf + s).length > target) {
      push();
      buf = s;
    } else {
      buf += s;
    }
  }
  push();
  return out;
}

/** Trailing slice of `text` of about `n` chars starting at a word boundary. */
function tail(text: string, n: number): string {
  if (n <= 0 || text.length <= n) return n <= 0 ? "" : text;
  const slice = text.slice(text.length - n);
  const sp = slice.search(/\s/);
  return (sp >= 0 && sp < n / 2 ? slice.slice(sp + 1) : slice).trim();
}

export function chunkText(text: string, opts: ChunkOptions = {}): TextChunk[] {
  const target = Math.max(200, opts.targetChars ?? DEFAULT_CHUNK_CHARS);
  const overlap = Math.min(Math.max(0, opts.overlapChars ?? DEFAULT_OVERLAP_CHARS), Math.floor(target / 2));
  const chunks: TextChunk[] = [];

  for (const section of splitSections(text, opts.defaultHeading ?? null)) {
    const paragraphs = section.body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .flatMap((p) => (p.startsWith("```") ? [p] : splitLong(p, target)));

    const pieces: string[] = [];
    let buf = "";
    for (const p of paragraphs) {
      if (buf && buf.length + p.length + 2 > target) {
        pieces.push(buf);
        buf = p;
      } else {
        buf = buf ? `${buf}\n\n${p}` : p;
      }
    }
    if (buf) pieces.push(buf);

    pieces.forEach((piece, i) => {
      const prefix = i > 0 ? tail(pieces[i - 1]!, overlap) : "";
      const content = prefix ? `${prefix}\n\n${piece}` : piece;
      chunks.push({
        chunkIndex: chunks.length,
        content,
        headingPath: section.headingPath,
        tokenCount: approxTokens(content),
      });
    });
  }
  return chunks;
}
