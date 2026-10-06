import { sid, type SeedContext } from "./context";
import { RESOURCES, type ResourceDef } from "./data/resources";
import { chunkText } from "@/server/domain/resources/chunker";
import { bulk, count, S, sha, type ChunkRef } from "./state";

export async function seedResources(ctx: SeedContext): Promise<void> {
  const p = ctx.prisma;
  const facultyId = ctx.ids.users["faculty"] as string;
  let chunkTotal = 0;
  for (const [i, def] of RESOURCES.entries()) {
    const courseId = ctx.ids.courses[def.courseKey] as string;
    const id = sid("res", def.courseKey, def.key);
    await p.courseResource.create({
      data: {
        id,
        courseId,
        title: def.title,
        type: def.type,
        status: "READY",
        accessScope: def.accessScope,
        version: 1,
        mimeType: "text/markdown",
        textContent: def.text,
        contentHash: sha(def.text),
        metadata: { source: "seed", words: def.text.split(/\s+/).length },
        uploadedById: facultyId,
        createdAt: new Date(S.anchor.getTime() - (40 - i) * 86_400_000),
      },
    });
    await bulk(
      p.courseResourceTopic,
      def.topics.map((t) => ({
        resourceId: id,
        topicId: ctx.ids.topics[`${def.courseKey}:${t}`] as string,
      })),
    );
    const chunks = chunkText(def.text, { defaultHeading: def.title });
    const chunkRefs: ChunkRef[] = chunks.map((c, idx) => ({
      id: sid("chunk", def.courseKey, def.key, idx),
      index: c.chunkIndex,
      heading: c.headingPath ?? def.title,
      content: c.content,
    }));
    await bulk(
      p.resourceChunk,
      chunkRefs.map((c) => ({
        id: c.id,
        resourceId: id,
        courseId,
        sourceVersion: 1,
        chunkIndex: c.index,
        content: c.content,
        tokenCount: Math.ceil(c.content.length / 4),
        headingPath: c.heading,
      })),
    );
    chunkTotal += chunkRefs.length;
    S.resources.push({ id, def: def as ResourceDef, courseId, chunks: chunkRefs });
  }

  // HW3 (closed) restricts Socra retrieval to the recursion notes.
  const hw3 = S.assignments.find((a) => a.courseKey === "cse115" && a.key === "hw3");
  if (hw3) {
    await p.assignment.update({
      where: { id: hw3.id },
      data: { resourceScope: "SELECTED_RESOURCES" },
    });
    await bulk(
      p.assignmentResource,
      ["lec12-recursion", "lec13-callstack"].map((k) => ({
        assignmentId: hw3.id,
        resourceId: sid("res", "cse115", k),
      })),
    );
  }
  count("resources", RESOURCES.length);
  count("resourceChunks", chunkTotal);
  ctx.log(`resources: ${RESOURCES.length}, chunks: ${chunkTotal}`);
}
