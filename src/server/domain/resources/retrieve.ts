import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { getAiProvider, modelForTier } from "@/server/ai/provider";
import type { RetrievedResource } from "@/server/ai/types";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { keywordTerms, rrfFuse, snippet, toOrTsQuery, toVectorLiteral } from "./search-utils";

export type RetrievedResourceWithSection = RetrievedResource & {
  /** Section/heading the chunk came from (for citations). */
  section: string | null;
  /** Alias of `excerpt`. */
  snippet: string;
};

export interface RetrieveInput {
  courseId: string;
  query: string;
  /** null/undefined = every COURSE_ALL resource of the course; array = restrict to these ids (empty = nothing). */
  allowedResourceIds?: string[] | null;
  topicIds?: string[];
  limit?: number;
  /** Staff tools only. Students/Socra never see STAFF_ONLY material. */
  includeStaffOnly?: boolean;
}

interface Row {
  chunkId: string;
  resourceId: string;
  version: number;
  title: string;
  headingPath: string | null;
  content: string;
  rank: number;
}

/**
 * Hard course scoping: every query filters `c."courseId" = courseId AND r."courseId" = courseId`, the resource must be
 * READY, and only chunks of the resource's CURRENT version are returned. ASSIGNMENT_SCOPED resources are returned only
 * when listed in `allowedResourceIds`; STAFF_ONLY never (unless `includeStaffOnly`).
 */
function scopeFilter(input: RetrieveInput): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`c."courseId" = ${input.courseId}`,
    Prisma.sql`r."courseId" = ${input.courseId}`,
    Prisma.sql`r.status = 'READY'`,
    Prisma.sql`c."sourceVersion" = r.version`,
  ];
  const allowed = input.allowedResourceIds;
  if (allowed) {
    parts.push(
      allowed.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`r.id IN (${Prisma.join(allowed)})`,
    );
    parts.push(
      input.includeStaffOnly
        ? Prisma.sql`TRUE`
        : Prisma.sql`r."accessScope" IN ('COURSE_ALL', 'ASSIGNMENT_SCOPED')`,
    );
  } else {
    parts.push(
      input.includeStaffOnly
        ? Prisma.sql`r."accessScope" IN ('COURSE_ALL', 'STAFF_ONLY')`
        : Prisma.sql`r."accessScope" = 'COURSE_ALL'`,
    );
  }
  if (input.topicIds?.length) {
    parts.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "CourseResourceTopic" t WHERE t."resourceId" = r.id AND t."topicId" IN (${Prisma.join(input.topicIds)}))`,
    );
  }
  return Prisma.join(parts, " AND ");
}

const SELECT_COLS = Prisma.sql`c.id AS "chunkId", r.id AS "resourceId", r.version AS "version", r.title AS "title",
  c."headingPath" AS "headingPath", c.content AS "content"`;

async function ftsSearch(input: RetrieveInput, limit: number): Promise<Row[]> {
  const where = scopeFilter(input);
  const q = input.query.trim();
  if (!q) return [];
  const websearch = await prisma.$queryRaw<Row[]>`
    SELECT ${SELECT_COLS}, ts_rank(c."searchVector", query) AS rank
    FROM "ResourceChunk" c
    JOIN "CourseResource" r ON r.id = c."resourceId",
         websearch_to_tsquery('english', ${q}) query
    WHERE ${where} AND c."searchVector" @@ query
    ORDER BY rank DESC, c."chunkIndex" ASC
    LIMIT ${limit}`;
  if (websearch.length) return websearch;

  const terms = keywordTerms(q);
  if (!terms.length) return [];
  // Keyword OR fallback (any term, prefix match).
  const orQuery = toOrTsQuery(terms);
  const orRows = await prisma.$queryRaw<Row[]>`
    SELECT ${SELECT_COLS}, ts_rank(c."searchVector", query) AS rank
    FROM "ResourceChunk" c
    JOIN "CourseResource" r ON r.id = c."resourceId",
         to_tsquery('english', ${orQuery}) query
    WHERE ${where} AND c."searchVector" @@ query
    ORDER BY rank DESC, c."chunkIndex" ASC
    LIMIT ${limit}`;
  if (orRows.length) return orRows;

  // Last resort: substring match on any term, ranked by number of terms hit.
  const likeScore = Prisma.join(
    terms.map((t) => Prisma.sql`(CASE WHEN lower(c.content) LIKE ${"%" + t + "%"} THEN 1 ELSE 0 END)`),
    " + ",
  );
  const likeAny = Prisma.join(
    terms.map((t) => Prisma.sql`lower(c.content) LIKE ${"%" + t + "%"}`),
    " OR ",
  );
  return prisma.$queryRaw<Row[]>`
    SELECT ${SELECT_COLS}, (${likeScore})::float AS rank
    FROM "ResourceChunk" c
    JOIN "CourseResource" r ON r.id = c."resourceId"
    WHERE ${where} AND (${likeAny})
    ORDER BY rank DESC, c."chunkIndex" ASC
    LIMIT ${limit}`;
}

async function vectorSearch(input: RetrieveInput, vector: number[], limit: number): Promise<Row[]> {
  const lit = toVectorLiteral(vector);
  return prisma.$queryRaw<Row[]>`
    SELECT ${SELECT_COLS}, (1 - (c.embedding <=> ${lit}::vector))::float AS rank
    FROM "ResourceChunk" c
    JOIN "CourseResource" r ON r.id = c."resourceId"
    WHERE ${scopeFilter(input)} AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> ${lit}::vector ASC
    LIMIT ${limit}`;
}

async function courseHasEmbeddings(courseId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT 1 AS n FROM "ResourceChunk" WHERE "courseId" = ${courseId} AND embedding IS NOT NULL LIMIT 1`;
  return rows.length > 0;
}

function toResult(
  row: Row,
  score: number,
  method: RetrievedResource["method"],
): RetrievedResourceWithSection {
  const text = snippet(row.content);
  return {
    resourceId: row.resourceId,
    chunkId: row.chunkId,
    resourceVersion: row.version,
    title: row.title,
    excerpt: text,
    snippet: text,
    section: row.headingPath,
    score,
    method,
  };
}

/**
 * Course-scoped retrieval. Mock mode (or a course with no embeddings, or an embedding failure) uses Postgres full-text
 * search; otherwise hybrid pgvector cosine + FTS fused with reciprocal-rank fusion.
 */
export async function retrieveCourseResources(
  input: RetrieveInput,
): Promise<RetrievedResourceWithSection[]> {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
  if (!input.query.trim() || !input.courseId) return [];
  if (input.allowedResourceIds && input.allowedResourceIds.length === 0) return [];
  const pool = limit * 3;

  let vectorRows: Row[] | null = null;
  if (!env().AI_MOCK_MODE) {
    try {
      if (await courseHasEmbeddings(input.courseId)) {
        const [vec] = await getAiProvider().embed([input.query], {
          model: modelForTier("embedding"),
        });
        if (vec) vectorRows = await vectorSearch(input, vec, pool);
      }
    } catch (err) {
      console.error("[retrieve] vector search failed; falling back to full-text", err);
      vectorRows = null;
    }
  }

  const ftsRows = await ftsSearch(input, pool);

  if (!vectorRows) {
    return ftsRows.slice(0, limit).map((r) => toResult(r, r.rank, "FULL_TEXT"));
  }

  const byId = new Map<string, Row>();
  for (const r of [...vectorRows, ...ftsRows]) if (!byId.has(r.chunkId)) byId.set(r.chunkId, r);
  const fused = rrfFuse([vectorRows.map((r) => r.chunkId), ftsRows.map((r) => r.chunkId)]);
  const inBoth = new Set(vectorRows.map((r) => r.chunkId));
  const ftsIds = new Set(ftsRows.map((r) => r.chunkId));
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id, score]) =>
      toResult(
        byId.get(id)!,
        score,
        inBoth.has(id) && ftsIds.has(id) ? "HYBRID" : inBoth.has(id) ? "VECTOR" : "FULL_TEXT",
      ),
    );
}
