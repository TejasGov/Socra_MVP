import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CurrentUser } from "@/server/auth/current-user";
import { disconnectPrisma, prisma } from "@/server/db";
import {
  completePracticeSession,
  nextPracticeItem,
  requestExplanation,
  startPracticeSession,
  submitPracticeAnswer,
} from "@/server/domain/practice";
import { ingestResource } from "@/server/domain/resources/ingest";
import { retrieveCourseResources } from "@/server/domain/resources/retrieve";

const RUN = randomUUID().slice(0, 8);
let courseA = "";
let courseB = "";
let topicA = "";
let instructor: CurrentUser;
let student: CurrentUser;

function principal(id: string, roles: CurrentUser["roles"], memberships: CurrentUser["memberships"]): CurrentUser {
  return { id, roles, isActive: true, memberships, email: `${id}@test.local`, name: id, sessionId: "" };
}

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.course.create({ data: { code: `RA${RUN}`, title: "Course A", term: "Test" } }),
    prisma.course.create({ data: { code: `RB${RUN}`, title: "Course B", term: "Test" } }),
  ]);
  courseA = a.id;
  courseB = b.id;
  const [ui, us] = await Promise.all([
    prisma.user.create({ data: { email: `inst_${RUN}@test.local`, name: "Inst", roles: ["INSTRUCTOR"] } }),
    prisma.user.create({ data: { email: `stud_${RUN}@test.local`, name: "Stud", roles: ["STUDENT"] } }),
  ]);
  instructor = principal(ui.id, ["INSTRUCTOR"], [
    { courseId: courseA, role: "INSTRUCTOR", status: "ACTIVE" },
    { courseId: courseB, role: "INSTRUCTOR", status: "ACTIVE" },
  ]);
  student = principal(us.id, ["STUDENT"], [{ courseId: courseA, role: "STUDENT", status: "ACTIVE" }]);
  topicA = (
    await prisma.topic.create({ data: { courseId: courseA, key: `rec-${RUN}`, name: "Recursion" } })
  ).id;
});

afterAll(async () => {
  await prisma.course.deleteMany({ where: { id: { in: [courseA, courseB] } } });
  // Users may be referenced by append-only rows (audit/events); leaving them is harmless in the test DB.
  await prisma.user.deleteMany({ where: { email: { endsWith: `_${RUN}@test.local` } } }).catch(() => undefined);
  await disconnectPrisma();
});

describe("course-scoped retrieval", () => {
  it("never returns course B resources for course A", async () => {
    const secret = "zebracorn";
    await ingestResource(instructor, {
      courseId: courseB,
      title: "B only notes",
      type: "LECTURE_NOTES",
      text: `# Secrets\n\nThe ${secret} protocol is only taught in course B. Recursion also appears here.`,
    });
    await ingestResource(instructor, {
      courseId: courseA,
      title: "A notes",
      type: "LECTURE_NOTES",
      text: "# Recursion\n\nRecursion needs a base case so the calls stop.",
      topicIds: [topicA],
    });

    const aHits = await retrieveCourseResources({ courseId: courseA, query: `${secret} recursion` });
    expect(aHits.length).toBeGreaterThan(0);
    expect(aHits.every((h) => h.title === "A notes")).toBe(true);
    expect(aHits.some((h) => h.excerpt.includes(secret))).toBe(false);

    const onlySecret = await retrieveCourseResources({ courseId: courseA, query: secret });
    expect(onlySecret).toEqual([]);

    const bHits = await retrieveCourseResources({ courseId: courseB, query: secret });
    expect(bHits[0]?.title).toBe("B only notes");
    expect(bHits[0]?.section).toBe("Secrets");
  });

  it("even an allowedResourceIds list naming a course B resource returns nothing for course A", async () => {
    const bRes = await prisma.courseResource.findFirstOrThrow({ where: { courseId: courseB } });
    const hits = await retrieveCourseResources({
      courseId: courseA,
      query: "recursion",
      allowedResourceIds: [bRes.id],
    });
    expect(hits).toEqual([]);
  });

  it("respects allowedResourceIds, topic filter, staff-only and archived/superseded content", async () => {
    const staff = await ingestResource(instructor, {
      courseId: courseA,
      title: "Staff solutions",
      type: "DOCUMENT",
      text: "Recursion answer key for staff.",
      accessScope: "STAFF_ONLY",
    });
    const all = await retrieveCourseResources({ courseId: courseA, query: "recursion", limit: 10 });
    expect(all.some((h) => h.resourceId === staff.resourceId)).toBe(false);

    expect(
      await retrieveCourseResources({ courseId: courseA, query: "recursion", allowedResourceIds: [] }),
    ).toEqual([]);
    const topical = await retrieveCourseResources({ courseId: courseA, query: "recursion", topicIds: [topicA] });
    expect(topical.map((h) => h.title)).toEqual(["A notes"]);

    // A new version supersedes the old chunks.
    const aRes = await prisma.courseResource.findFirstOrThrow({ where: { courseId: courseA, title: "A notes" } });
    const v2 = await ingestResource(instructor, {
      courseId: courseA,
      resourceId: aRes.id,
      title: "A notes",
      type: "LECTURE_NOTES",
      text: "# Recursion\n\nNow about memoization and caching results.",
      topicIds: [topicA],
    });
    expect(v2.version).toBe(2);
    expect(await retrieveCourseResources({ courseId: courseA, query: "base case calls stop" })).toEqual([]);
    const fresh = await retrieveCourseResources({ courseId: courseA, query: "memoization" });
    expect(fresh[0]?.resourceVersion).toBe(2);
  });

  it("rejects unsupported uploads and non-managers", async () => {
    await expect(
      ingestResource(instructor, {
        courseId: courseA,
        title: "x",
        type: "SLIDES",
        file: { name: "deck.pptx", size: 5, bytes: new Uint8Array(5) },
      }),
    ).rejects.toMatchObject({ code: "unsupported_file_type" });
    await expect(
      ingestResource(student, { courseId: courseA, title: "x", type: "OTHER", text: "hello" }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("practice flow", () => {
  it("serves approved faculty items without immediate repetition, adapts, and writes events", async () => {
    const mk = (n: number, difficulty: number) =>
      prisma.practiceItem.create({
        data: {
          courseId: courseA,
          topicId: topicA,
          difficulty,
          type: "SHORT_ANSWER",
          prompt: `Practice question ${n} about recursion ${RUN}`,
          answer: `answer${n}`,
          explanation: `Because ${n}`,
          source: "FACULTY",
          reviewStatus: "APPROVED",
          contentHash: `h${RUN}${n}`,
        },
      });
    const items = await Promise.all([mk(1, 2), mk(2, 2), mk(3, 2), mk(4, 3), mk(5, 3)]);
    const byPrompt = new Map(items.map((i) => [i.id, i]));

    const { sessionId, currentDifficulty } = await startPracticeSession(student, { courseId: courseA, topicId: topicA });
    expect(currentDifficulty).toBe(2);

    const seen: string[] = [];
    let last: Awaited<ReturnType<typeof submitPracticeAnswer>> | null = null;
    for (let i = 0; i < 4; i++) {
      const { item } = await nextPracticeItem(student, sessionId);
      expect(item).not.toBeNull();
      expect(item).not.toHaveProperty("answer");
      seen.push(item!.itemId);
      last = await submitPracticeAnswer(student, {
        sessionId,
        itemId: item!.itemId,
        answer: byPrompt.get(item!.itemId)!.answer!,
      });
      expect(last.correct).toBe(true);
    }
    expect(new Set(seen).size).toBe(4);
    // two correct at level 2 -> level 3
    expect(last!.nextDifficulty).toBeGreaterThanOrEqual(3);

    // an unanswered served item is re-served on reload
    const { item: pending } = await nextPracticeItem(student, sessionId);
    const again = await nextPracticeItem(student, sessionId);
    expect(again.item?.itemId).toBe(pending?.itemId);

    const ex = await requestExplanation(student, { sessionId, itemId: pending!.itemId });
    expect(ex.explanation.length).toBeGreaterThan(0);

    const summary = await completePracticeSession(student, sessionId);
    expect(summary.correctCount).toBe(4);

    const names = (
      await prisma.analyticsEvent.findMany({ where: { sessionId }, select: { eventName: true } })
    ).map((e) => e.eventName);
    expect(names.filter((n) => n === "practice_answered")).toHaveLength(4);
    for (const n of ["practice_started", "practice_item_shown", "explanation_requested", "practice_completed"]) {
      expect(names).toContain(n);
    }
  });

  it("live-generates (or degrades gracefully) when there are no stored items", async () => {
    const t2 = await prisma.topic.create({ data: { courseId: courseB, key: `empty-${RUN}`, name: "Empty" } });
    const s = await prisma.user.create({ data: { email: `stud2_${RUN}@test.local`, name: "S2" } });
    const stu = principal(s.id, ["STUDENT"], [{ courseId: courseB, role: "STUDENT", status: "ACTIVE" }]);
    const { sessionId } = await startPracticeSession(stu, { courseId: courseB, topicId: t2.id });
    const res = await nextPracticeItem(stu, sessionId);
    // Spec §15 tier 3: with no stored items, practice falls through to live generation.
    // If generation is unavailable it must return a message instead of crashing.
    if (res.item) {
      expect(res.item.source).toBe("LIVE_GENERATED");
    } else {
      expect(res.message).toMatch(/No practice questions/);
    }
  });

  it("does not let another student use the session", async () => {
    const { sessionId } = await startPracticeSession(student, { courseId: courseA });
    const other = principal("someone-else", ["STUDENT"], [{ courseId: courseA, role: "STUDENT", status: "ACTIVE" }]);
    await expect(nextPracticeItem(other, sessionId)).rejects.toMatchObject({ status: 404 });
  });
});
