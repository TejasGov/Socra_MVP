import type { Job } from "bullmq";
import { getAiProvider, modelForTier } from "@/server/ai/provider";
import { EMBEDDING_DIMENSIONS } from "@/server/ai/types";
import { prisma } from "@/server/db";
import { toVectorLiteral } from "@/server/domain/resources/search-utils";

/**
 * Embeddings job (queue "embeddings").
 *   { resourceId, version }  -> embed every chunk of that resource version that has no vector yet
 *   { practiceItemId }       -> embed one practice item (prompt + explanation) for similar-item retrieval
 * Vectors are written with raw SQL (Prisma cannot write `vector`), together with embeddingModel and (for chunks)
 * embeddedAt. Every vector points at its source via ResourceChunk.resourceId + sourceVersion.
 */

const BATCH = 32;

export interface EmbeddingsJobData {
  resourceId?: string;
  version?: number;
  practiceItemId?: string;
}

async function embedAll(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  const model = modelForTier("embedding");
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const vectors = await getAiProvider().embed(slice, { model });
    if (vectors.length !== slice.length) throw new Error("Embedding provider returned wrong count");
    for (const v of vectors) {
      if (v.length !== EMBEDDING_DIMENSIONS) {
        throw new Error(`Embedding has ${v.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`);
      }
      out.push(v);
    }
  }
  return out;
}

export async function embedResourceVersion(
  resourceId: string,
  version: number,
): Promise<{ embedded: number }> {
  const resource = await prisma.courseResource.findUnique({
    where: { id: resourceId },
    select: { version: true, courseId: true },
  });
  // A newer version superseded this one: nothing to do.
  if (!resource || resource.version !== version) return { embedded: 0 };

  const chunks = await prisma.$queryRaw<Array<{ id: string; content: string; headingPath: string | null }>>`
    SELECT id, content, "headingPath" FROM "ResourceChunk"
    WHERE "resourceId" = ${resourceId} AND "sourceVersion" = ${version} AND embedding IS NULL
    ORDER BY "chunkIndex"`;
  if (!chunks.length) return { embedded: 0 };

  const model = modelForTier("embedding");
  const vectors = await embedAll(
    chunks.map((c) => (c.headingPath ? `${c.headingPath}\n${c.content}` : c.content)),
  );
  for (let i = 0; i < chunks.length; i++) {
    const lit = toVectorLiteral(vectors[i]!);
    await prisma.$executeRaw`
      UPDATE "ResourceChunk"
      SET embedding = ${lit}::vector, "embeddingModel" = ${model}, "embeddedAt" = now()
      WHERE id = ${chunks[i]!.id} AND "sourceVersion" = ${version}`;
  }
  return { embedded: chunks.length };
}

export async function embedPracticeItem(practiceItemId: string): Promise<{ embedded: number }> {
  const item = await prisma.practiceItem.findUnique({
    where: { id: practiceItemId },
    select: { prompt: true, explanation: true },
  });
  if (!item) return { embedded: 0 };
  const [vec] = await embedAll([`${item.prompt}\n${item.explanation ?? ""}`.trim()]);
  const model = modelForTier("embedding");
  await prisma.$executeRaw`
    UPDATE "PracticeItem" SET embedding = ${toVectorLiteral(vec!)}::vector, "embeddingModel" = ${model}
    WHERE id = ${practiceItemId}`;
  return { embedded: 1 };
}

export async function processEmbeddingsJob(job: Job): Promise<unknown> {
  const data = job.data as EmbeddingsJobData;
  if (data.resourceId && typeof data.version === "number") {
    return embedResourceVersion(data.resourceId, data.version);
  }
  if (data.practiceItemId) return embedPracticeItem(data.practiceItemId);
  throw new Error("embeddings job needs { resourceId, version } or { practiceItemId }");
}
