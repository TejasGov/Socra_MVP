import { sid, type SeedContext } from "./context";
import { MISCONCEPTIONS } from "./data/learning";
import { count, S } from "./state";

export async function seedMisconceptions(ctx: SeedContext): Promise<void> {
  const facultyId = ctx.ids.users["faculty"] as string;
  const rows = [];
  for (const def of MISCONCEPTIONS) {
    for (const courseKey of ["cse115", "cse116"] as const) {
      const topicKey = def.topic[courseKey];
      if (!topicKey) continue;
      const topicId = ctx.ids.topics[`${courseKey}:${topicKey}`] as string;
      const id = sid("misc", courseKey, def.key);
      rows.push({
        id,
        courseId: ctx.ids.courses[courseKey] as string,
        topicId,
        key: def.key,
        label: def.label,
        description: def.description,
        source: "FACULTY" as const,
        reviewStatus: "APPROVED" as const,
        taxonomyVersion: 1,
        createdById: facultyId,
      });
      S.misconceptions.push({ id, key: def.key, courseKey, topicKey, topicId, def });
    }
  }
  await ctx.prisma.misconception.createMany({ data: rows });
  count("misconceptions", rows.length);
  ctx.log(`misconceptions: ${rows.length} (${MISCONCEPTIONS.length} canonical)`);
}
