import type { Prisma } from "@/generated/prisma/client";
import { sid, type SeedContext } from "./context";
import { ALL_ASSIGNMENTS } from "./data/all";
import type { AssignmentDef, QuestionDef } from "./data/types";
import { bulk, count, DAY_MS, S, sha, type AssignmentRef, type QuestionRef } from "./state";

const OBJECTIVES: Record<
  "cse115" | "cse116",
  Array<{ code: string; description: string; topics: string[] }>
> = {
  cse115: [
    {
      code: "LO-FLOW-1",
      description: "Use loops and conditionals to build, filter and summarize lists.",
      topics: ["control-flow", "lists"],
    },
    {
      code: "LO-REC-1",
      description: "Write recursive functions whose base case is reachable from every valid input.",
      topics: ["recursion", "recursion-base-cases"],
    },
    {
      code: "LO-REC-2",
      description: "Trace nested function calls through the call stack.",
      topics: ["call-stack-tracing"],
    },
  ],
  cse116: [
    {
      code: "LO-REC-1",
      description: "Write recursive functions whose base case is reachable from every valid input.",
      topics: ["recursion", "recursion-base-cases"],
    },
    {
      code: "LO-LL-1",
      description: "Traverse and search singly linked lists.",
      topics: ["linked-structures"],
    },
    {
      code: "LO-TREE-1",
      description: "Define and perform binary tree traversals.",
      topics: ["trees", "traversal"],
    },
    {
      code: "LO-COMP-1",
      description: "Compare growth rates using Big-O notation.",
      topics: ["asymptotic-complexity"],
    },
  ],
};

const LADDER_NAMES = [
  "Orientation",
  "Conceptual nudge",
  "Targeted question",
  "Worked analogy",
  "Structure outline",
  "Pinpoint location",
  "Escalate to staff",
];

function hintLadder(def: AssignmentDef): Prisma.InputJsonValue {
  return LADDER_NAMES.map((name, level) => ({
    level,
    name,
    guidance:
      level === 0
        ? "Restate the goal, point to the relevant lecture section, and ask what the student has tried."
        : level === 6
          ? "Offer to flag the conversation to course staff with a short student-written note. Do not include the transcript."
          : `Level ${level}: ${name}. Questions first; never provide a complete solution or hidden-test details.`,
    questionHints: Object.fromEntries(
      def.questions
        .filter((q) => q.hints[level - 1])
        .map((q) => [q.key, q.hints[level - 1] as string]),
    ),
  })) as unknown as Prisma.InputJsonValue;
}

function questionSnapshot(q: QuestionDef, ref: QuestionRef) {
  return {
    questionId: ref.id,
    questionVersionId: ref.versionId,
    version: 1,
    order: ref.order,
    title: q.title,
    prompt: q.prompt,
    type: q.type,
    points: q.points,
    language: q.language,
    entryPoint: q.entryPoint ?? null,
    starterCode: q.starterCode ?? null,
    choices: q.choices ?? null,
    publicTests: q.tests
      .filter((t) => t.visibility === "PUBLIC")
      .map((t) => ({ id: t.id, name: t.name })),
    hiddenTestCount: q.tests.filter((t) => t.visibility === "HIDDEN").length,
    topicKeys: q.topics.map((t) => t.key),
  };
}

export async function seedAssignments(ctx: SeedContext): Promise<void> {
  const p = ctx.prisma;
  const anchor = S.anchor;
  const facultyId = ctx.ids.users["faculty"];
  if (!facultyId) throw new Error("seedAssignments: faculty user missing");
  const at = (day: number | null) =>
    day === null ? null : new Date(anchor.getTime() + day * DAY_MS);

  // Learning objectives
  const loIds: Record<string, string> = {};
  for (const courseKey of ["cse115", "cse116"] as const) {
    const courseId = ctx.ids.courses[courseKey] as string;
    for (const [order, lo] of (OBJECTIVES[courseKey] ?? []).entries()) {
      const id = sid("lo", courseKey, lo.code);
      loIds[`${courseKey}:${lo.code}`] = id;
      await p.learningObjective.create({
        data: { id, courseId, code: lo.code, description: lo.description, order },
      });
      await bulk(
        p.learningObjectiveTopic,
        lo.topics.map((t) => ({
          objectiveId: id,
          topicId: ctx.ids.topics[`${courseKey}:${t}`] as string,
        })),
      );
    }
  }

  let qCount = 0;
  let testCount = 0;
  for (const def of ALL_ASSIGNMENTS) {
    const courseId = ctx.ids.courses[def.courseKey] as string;
    const aid = sid("asg", def.courseKey, def.key);
    const published = def.state !== "DRAFT";
    const openAt = at(def.openDay);
    const dueAt = at(def.dueDay);
    const totalPoints = def.questions.reduce((s, q) => s + q.points, 0);

    // Policy lineage (immutable version row)
    const policyId = sid("pol", def.courseKey, def.key);
    const policyVersionId = sid("polv", def.courseKey, def.key, 1);
    await p.socraPolicy.create({ data: { id: policyId, courseId, name: `${def.title} policy` } });
    await p.socraPolicyVersion.create({
      data: {
        id: policyVersionId,
        policyId,
        version: 1,
        maxInterventionLevel: def.policyMaxLevel,
        hintLadder: hintLadder(def),
        allowedBehaviors: [
          "Ask guiding questions",
          "Point to a lecture section",
          "Explain error messages in general terms",
          "Ask the student to trace a small example",
        ],
        forbiddenBehaviors: [
          "Provide a complete solution",
          "Reveal hidden tests or their inputs",
          "Write the line that fixes the bug verbatim before level 5",
        ],
        allowDirectSyntaxHelp: def.format !== "QUIZ",
        allowResourceRetrieval: def.format !== "QUIZ",
        maxTurnsPerSession: 20,
        maxTurnsPerDay: 40,
        escalationMessage:
          "I am flagging this for your instructor and TA so a person can follow up. They will see a short note from you, not this conversation.",
        notes:
          def.format === "QUIZ"
            ? "Quiz: orientation only (L0-L1); no code-level hints."
            : "Protected Socratic mode; ladder levels L0-L5, L6 escalates.",
        createdById: facultyId,
      },
    });
    await p.socraPolicy.update({
      where: { id: policyId },
      data: { currentVersionId: policyVersionId },
    });

    await p.assignment.create({
      data: {
        id: aid,
        courseId,
        title: def.title,
        description: def.description,
        format: def.format,
        language: def.language,
        state: def.state,
        openAt,
        dueAt,
        closeAt: def.closed ? dueAt : null,
        attemptLimit: def.attemptLimit,
        allowResubmission: true,
        totalPoints,
        solutionReleaseMode: def.solutionsReleased ? "MANUAL" : "MANUAL",
        solutionsReleased: def.solutionsReleased ?? false,
        solutionsReleasedAt: def.solutionsReleased
          ? new Date((dueAt as Date).getTime() + 2 * DAY_MS)
          : null,
        resourceScope: "ALL_COURSE_RESOURCES",
        socraPolicyId: policyId,
        aiGenerated: def.state === "DRAFT",
        createdById: facultyId,
        publishedAt: published ? new Date((openAt as Date).getTime() - 2 * DAY_MS) : null,
        closedAt: def.closed ? dueAt : null,
        createdAt: new Date(((openAt ?? at(-3)) as Date).getTime() - 5 * DAY_MS),
      },
    });

    // Questions + versions + tests + rubric + scaffold
    const refs: QuestionRef[] = [];
    for (const [order, q] of def.questions.entries()) {
      const qid = sid("q", def.courseKey, def.key, q.key);
      const qvid = sid("qv", def.courseKey, def.key, q.key, 1);
      await p.question.create({ data: { id: qid, assignmentId: aid, order } });
      await p.questionVersion.create({
        data: {
          id: qvid,
          questionId: qid,
          version: 1,
          title: q.title,
          prompt: q.prompt,
          type: q.type,
          points: q.points,
          language: q.language,
          starterCode: q.starterCode ?? null,
          entryPoint: q.entryPoint ?? null,
          referenceSolution: q.reference ?? null,
          choices: (q.choices ?? undefined) as Prisma.InputJsonValue | undefined,
          answerKey: (q.answerKey ?? undefined) as Prisma.InputJsonValue | undefined,
          difficulty: q.difficulty,
          createdById: facultyId,
        },
      });
      await p.question.update({ where: { id: qid }, data: { currentVersionId: qvid } });
      await bulk(
        p.testCase,
        q.tests.map((t, i) => ({
          id: sid("tc", def.courseKey, def.key, q.key, t.id),
          questionVersionId: qvid,
          name: t.name,
          visibility: t.visibility,
          weight: t.weight,
          order: i,
          // Stores the TestSpec (src/server/runner/types.ts) split across the three JSON columns.
          input: {
            specId: t.id,
            kind: t.kind,
            entryPoint: t.entryPoint ?? null,
            args: t.args ?? null,
            stdin: t.stdin ?? null,
          },
          expected: { returns: t.expectedReturn ?? null, stdout: t.expectedStdout ?? null },
          harness: { comparator: t.comparator ?? "exact", tolerance: t.tolerance ?? null },
          timeoutMs: t.timeoutMs ?? null,
          failureHint: t.failureHint ?? null,
        })) as Prisma.TestCaseCreateManyInput[],
      );
      testCount += q.tests.length;
      await bulk(
        p.scaffoldStage,
        q.scaffold.map((s, i) => ({
          id: sid("scf", def.courseKey, def.key, q.key, i),
          questionVersionId: qvid,
          order: i,
          title: s.stage,
          instructions: s.instructions,
          hint: s.hint ?? null,
        })),
      );
      const rubricId = sid("rub", def.courseKey, def.key, q.key);
      await p.rubric.create({
        data: {
          id: rubricId,
          assignmentId: aid,
          questionId: qid,
          title: `${q.title} rubric`,
          version: 1,
        },
      });
      await bulk(
        p.rubricCriterion,
        q.rubric.map((c, i) => ({
          id: sid("crit", def.courseKey, def.key, q.key, i),
          rubricId,
          order: i,
          title: c.title,
          description: c.description,
          maxPoints: c.maxPoints,
        })),
      );
      const topicIds = q.topics.map((t) => ({
        id: ctx.ids.topics[`${def.courseKey}:${t.key}`] as string,
        key: t.key,
        weight: t.weight,
      }));
      await bulk(
        p.questionTopic,
        topicIds.map((t) => ({ questionId: qid, topicId: t.id, weight: t.weight })),
      );
      refs.push({ id: qid, versionId: qvid, version: 1, def: q, order, topicIds });
      qCount++;
    }

    // Assignment-level topic and objective links
    const topicSet = new Map<string, string>();
    for (const r of refs) for (const t of r.topicIds) topicSet.set(t.key, t.id);
    await bulk(
      p.assignmentTopic,
      [...topicSet.values()].map((topicId) => ({ assignmentId: aid, topicId })),
    );
    await bulk(
      p.assignmentLearningObjective,
      def.objectives.map((code) => ({
        assignmentId: aid,
        objectiveId: loIds[`${def.courseKey}:${code}`] as string,
      })),
    );

    // Immutable version snapshot for published/closed assignments
    let versionId: string | null = null;
    if (published) {
      versionId = sid("asgv", def.courseKey, def.key, 1);
      const snapshot = {
        assignmentId: aid,
        version: 1,
        title: def.title,
        description: def.description,
        format: def.format,
        language: def.language,
        totalPoints,
        dueAt: dueAt?.toISOString() ?? null,
        policyVersionId,
        questions: def.questions.map((q, i) => questionSnapshot(q, refs[i] as QuestionRef)),
      };
      await p.assignmentVersion.create({
        data: {
          id: versionId,
          assignmentId: aid,
          version: 1,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          snapshotHash: sha(JSON.stringify(snapshot)),
          policyVersionId,
          changeNote: "Initial publish",
          createdById: facultyId,
          createdAt: new Date((openAt as Date).getTime() - 2 * DAY_MS),
          publishedAt: new Date((openAt as Date).getTime() - 2 * DAY_MS),
        },
      });
      await p.assignment.update({ where: { id: aid }, data: { currentVersionId: versionId } });
    }

    if (def.state === "DRAFT") {
      await p.authoringSuggestion.createMany({
        data: [
          {
            id: sid("sugg", def.courseKey, def.key, "full"),
            courseId,
            assignmentId: aid,
            kind: "full_assignment",
            input: {
              prompt: "Recursive functions on binary trees",
              format: "CODING",
              language: "PYTHON",
            },
            content: {
              title: def.title,
              questions: def.questions.map((q) => q.title),
              note: "Edited by faculty before saving.",
            },
            status: "EDITED",
            createdById: facultyId,
            resolvedAt: new Date(anchor.getTime() - 2 * DAY_MS),
            createdAt: new Date(anchor.getTime() - 3 * DAY_MS),
          },
          {
            id: sid("sugg", def.courseKey, def.key, "hints"),
            courseId,
            assignmentId: aid,
            kind: "hint_ladder",
            input: { questionKey: "height" },
            content: {
              levels: [
                "What is the height of a tree with no nodes?",
                "How does a tree's height relate to its subtrees?",
              ],
            },
            status: "PENDING",
            createdById: facultyId,
            createdAt: new Date(anchor.getTime() - 1 * DAY_MS),
          },
        ],
      });
    }

    S.assignments.push({
      key: def.key,
      id: aid,
      courseKey: def.courseKey,
      courseId,
      def,
      versionId,
      version: published ? 1 : null,
      policyId,
      policyVersion: 1,
      questions: refs,
      openAt,
      dueAt,
      closeAt: def.closed ? dueAt : null,
    } satisfies AssignmentRef);
  }
  count("assignments", ALL_ASSIGNMENTS.length);
  count("questions", qCount);
  count("testCases", testCount);
  ctx.log(`assignments: ${ALL_ASSIGNMENTS.length}, questions: ${qCount}, test cases: ${testCount}`);
}
