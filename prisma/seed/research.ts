import type { StudyCondition } from "@/generated/prisma/enums";
import { pseudonymFor, PSEUDONYM_KEY_VERSION, PSEUDONYM_METHOD } from "@/server/events/pseudonym";
import type { SeedContext } from "./context";
import { enrollmentPlan } from "./courses";

const ROTATION: StudyCondition[] = ["SOCRATIC_AI", "UNRESTRICTED_AI", "CONTROL"];

/**
 * Deterministic condition assignment ("seed-deterministic-v1"):
 *   student1..3 -> SOCRATIC_AI (demo accounts exercise protected Socra),
 *   others      -> rotation by student number (n mod 3) over SOCRATIC_AI, UNRESTRICTED_AI, CONTROL.
 * The same condition is used in both courses for a student. Existing participants are never changed
 * (conditions must not switch silently; changes go through StudyConditionChange + audit).
 */
export function conditionFor(studentNumber: number): StudyCondition {
  if (studentNumber <= 3) return "SOCRATIC_AI";
  return ROTATION[studentNumber % 3] ?? "SOCRATIC_AI";
}

export async function seedResearch(ctx: SeedContext): Promise<void> {
  const researcherId = ctx.ids.users["research"] ?? null;
  let count = 0;
  for (const e of enrollmentPlan().filter((p) => p.role === "STUDENT")) {
    const userId = ctx.ids.users[e.userKey];
    const courseId = ctx.ids.courses[e.courseKey];
    if (!userId || !courseId) continue;
    const n = Number(e.userKey.replace("student", ""));
    const participantId = pseudonymFor(userId);
    await ctx.prisma.researchParticipantMapping.upsert({
      where: { userId },
      create: {
        userId,
        participantId,
        method: PSEUDONYM_METHOD,
        keyVersion: PSEUDONYM_KEY_VERSION,
      },
      update: {},
    });
    await ctx.prisma.studyParticipant.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: {
        userId,
        courseId,
        pseudonymousId: participantId,
        condition: conditionFor(n),
        consentStatus: n % 10 === 0 ? "DECLINED" : "CONSENTED",
        consentBasis: n % 10 === 0 ? null : "Synthetic pilot consent (development data)",
        assignedById: researcherId,
        assignmentMethod: "seed-deterministic-v1",
        conditionLocked: true,
      },
      update: {},
    });
    count++;
  }
  ctx.log(`study participants: ${count}`);
}
