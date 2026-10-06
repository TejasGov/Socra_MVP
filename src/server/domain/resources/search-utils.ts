/** Pure helpers for retrieval (unit-testable). */

const STOPWORDS = new Set(
  "a an and are as at be but by can do does for from has have how i if in is it its me my of on or so than that the their then there these this to was we what when where which who why will with you your about into out up not no".split(
    " ",
  ),
);

/** Lowercase alphanumeric keywords (>= 2 chars), stopwords removed, de-duplicated, order preserved. */
export function keywordTerms(query: string, max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of query.toLowerCase().match(/[a-z0-9_]+/g) ?? []) {
    if (raw.length < 2 || STOPWORDS.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= max) break;
  }
  return out;
}

/** A `to_tsquery` string matching ANY term (`a | b | c`). Terms are already sanitized to [a-z0-9_]. */
export function toOrTsQuery(terms: string[]): string {
  return terms.map((t) => `${t}:*`).join(" | ");
}

/** pgvector text literal for a number[] (`[0.1,0.2]`). Rejects non-finite values. */
export function toVectorLiteral(v: number[]): string {
  if (v.some((x) => !Number.isFinite(x))) throw new Error("Embedding contains non-finite values");
  return `[${v.join(",")}]`;
}

/** Reciprocal-rank fusion of several ranked id lists. Higher is better. */
export function rrfFuse(lists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return scores;
}

/** Trim content to a snippet of at most `max` chars at a word boundary. */
export function snippet(content: string, max = 600): string {
  const t = content.trim();
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(" ", max);
  return `${t.slice(0, cut > max * 0.6 ? cut : max).trim()}...`;
}
