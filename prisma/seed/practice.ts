import { sid, type SeedContext } from "./context";
import { PRACTICE } from "./data/learning";
import { count, S, sha } from "./state";

export async function seedPractice(ctx: SeedContext): Promise<void> {
  const facultyId = ctx.ids.users["faculty"] as string;
  const rows = [];
  for (const def of PRACTICE) {
    for (const courseKey of def.courses) {
      const topicId = ctx.ids.topics[`${courseKey}:${def.topic}`] as string;
      const id = sid("pi", courseKey, def.key);
      const source = def.source ?? "FACULTY";
      const approved = !def.pending;
      const misc = def.misconception
        ? S.misconceptions.find((m) => m.courseKey === courseKey && m.key === def.misconception)
        : undefined;
      rows.push({
        id,
        courseId: ctx.ids.courses[courseKey] as string,
        topicId,
        difficulty: def.difficulty,
        type: def.type,
        language: "PYTHON" as const,
        prompt: def.prompt,
        answer: def.answer,
        explanation: def.explanation,
        choices: def.choices ?? undefined,
        rubric: def.accepted ? { accepted: def.accepted, normalize: "trim-lowercase" } : undefined,
        source,
        reviewStatus: approved ? ("APPROVED" as const) : ("PENDING" as const),
        generationModel: source === "CACHED_GENERATED" ? "mock-economy-1" : null,
        generationPromptVersion: source === "CACHED_GENERATED" ? "practice-gen-v1" : null,
        targetedMisconceptionId: misc?.id ?? null,
        contentHash: sha(`${courseKey}:${def.prompt}:${def.answer}`),
        createdById: facultyId,
        approvedById: approved ? facultyId : null,
      });
      S.practiceItems.push({
        id,
        courseKey,
        topicKey: def.topic,
        topicId,
        difficulty: def.difficulty,
        def,
        approved,
        source,
      });
    }
  }
  await ctx.prisma.practiceItem.createMany({ data: rows });
  count("practiceItems", rows.length);
  ctx.log(
    `practice items: ${rows.length} (${rows.filter((r) => r.source === "FACULTY").length} faculty, ${rows.filter((r) => r.source === "CACHED_GENERATED").length} cached generated)`,
  );
}
