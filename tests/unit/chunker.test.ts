import { describe, expect, it } from "vitest";
import { chunkText, splitSections } from "@/server/domain/resources/chunker";
import {
  keywordTerms,
  rrfFuse,
  toOrTsQuery,
  toVectorLiteral,
} from "@/server/domain/resources/search-utils";
import {
  decodeTextBytes,
  ResourceValidationError,
  validateText,
  validateUpload,
} from "@/server/domain/resources/upload";

const para = (n: number) => `Sentence number one is here. Another sentence follows it. ${"word ".repeat(n)}end.`;

describe("chunker", () => {
  it("keeps heading paths with chunks", () => {
    const md = `# Recursion\n\nIntro text.\n\n## Base cases\n\nEvery recursion needs a base case.\n\n## Recursive step\n\nShrink the problem.`;
    const chunks = chunkText(md);
    expect(chunks.map((c) => c.headingPath)).toEqual([
      "Recursion",
      "Recursion > Base cases",
      "Recursion > Recursive step",
    ]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
  });

  it("uses the default heading when text has none", () => {
    const chunks = chunkText("Just a paragraph.", { defaultHeading: "Notes" });
    expect(chunks[0]?.headingPath).toBe("Notes");
  });

  it("packs paragraphs to about the target size and overlaps within a section", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Paragraph ${i}. ${para(30)}`).join("\n\n");
    const chunks = chunkText(text, { targetChars: 800, overlapChars: 100 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(800 + 100 + 4);
    const tailWords = chunks[0]!.content.split(/\s+/).slice(-3).join(" ");
    expect(chunks[1]!.content).toContain(tailWords);
  });

  it("splits one huge paragraph", () => {
    const chunks = chunkText(para(2000), { targetChars: 800 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.content.length).toBeLessThan(1000);
  });

  it("does not treat # inside code fences as headings", () => {
    const sections = splitSections("# A\n\n```python\n# not a heading\nx = 1\n```\n");
    expect(sections).toHaveLength(1);
    expect(sections[0]!.body).toContain("# not a heading");
  });

  it("returns nothing for empty text", () => {
    expect(chunkText("   \n\n ")).toEqual([]);
  });
});

describe("search utils", () => {
  it("extracts keywords without stopwords", () => {
    expect(keywordTerms("What is the base case of recursion?")).toEqual([
      "base",
      "case",
      "recursion",
    ]);
  });
  it("builds an OR tsquery", () => {
    expect(toOrTsQuery(["base", "case"])).toBe("base:* | case:*");
  });
  it("formats vectors and rejects NaN", () => {
    expect(toVectorLiteral([0.5, 1])).toBe("[0.5,1]");
    expect(() => toVectorLiteral([NaN])).toThrow();
  });
  it("fuses rankings", () => {
    const s = rrfFuse([
      ["a", "b"],
      ["b", "c"],
    ]);
    expect(s.get("b")!).toBeGreaterThan(s.get("a")!);
    expect(s.get("b")!).toBeGreaterThan(s.get("c")!);
  });
});

describe("upload validation", () => {
  it("accepts md and txt", () => {
    expect(validateUpload({ name: "Notes.MD", size: 10, mimeType: "text/markdown" }).mimeType).toBe(
      "text/markdown",
    );
    expect(validateUpload({ name: "a.txt", size: 10, mimeType: "" }).mimeType).toBe("text/plain");
  });
  it("rejects other types with a clear message", () => {
    expect(() =>
      validateUpload({ name: "slides.pdf", size: 10, mimeType: "application/pdf" }),
    ).toThrow(/\.txt and \.md/);
    expect(() => validateUpload({ name: "a.md", size: 10, mimeType: "image/png" })).toThrow(
      ResourceValidationError,
    );
  });
  it("rejects empty and oversized files", () => {
    expect(() => validateUpload({ name: "a.md", size: 0 })).toThrow(/empty/);
    expect(() => validateUpload({ name: "a.md", size: 2_000_000 })).toThrow(/limit/);
  });
  it("rejects binary content and blank text", () => {
    expect(() => decodeTextBytes(new Uint8Array([104, 0, 105]))).toThrow(/text/);
    expect(() => validateText("   ")).toThrow();
  });
});
