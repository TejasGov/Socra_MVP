/**
 * One-off backfill: embed every current-version course resource chunk (and practice item)
 * that has no vector yet. Needs OPENAI_API_KEY (not mock mode). Safe to re-run.
 *   npx tsx --conditions=react-server scripts/backfill-embeddings.ts
 */
import "../worker/load-env";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { embedPracticeItem, embedResourceVersion } from "../worker/jobs/embeddings";

async function main() {
  if (env().AI_MOCK_MODE) {
    console.log("AI mock mode is on (no OPENAI_API_KEY); nothing to embed. Retrieval uses full-text search.");
    return;
  }
  const resources = await prisma.courseResource.findMany({ select: { id: true, title: true, version: true } });
  let chunks = 0;
  for (const r of resources) {
    const { embedded } = await embedResourceVersion(r.id, r.version);
    chunks += embedded;
    console.log(`resource ${r.title} v${r.version}: ${embedded} chunk(s) embedded`);
  }
  const items = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "PracticeItem" WHERE embedding IS NULL`;
  for (const i of items) await embedPracticeItem(i.id);
  console.log(`done: ${chunks} chunk(s), ${items.length} practice item(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
