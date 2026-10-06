import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma, type Tx } from "@/server/db";
import { assertCan, type Principal } from "@/server/auth/rbac";
import type { CurrentUser } from "@/server/auth/current-user";
import { writeEvent } from "@/server/events";
import { writeAudit } from "@/server/audit";
import { isEnabled } from "@/server/flags";
import { HttpError } from "@/server/http";
import {
  assignmentInputSchema,
  assignmentScheduleUpdateSchema,
  DEFAULT_ALLOWED_BEHAVIORS,
  DEFAULT_FORBIDDEN_BEHAVIORS,
  DEFAULT_HINT_LADDER,
  type AssignmentInput,
  type QuestionInput,
} from "./schema";
import { rowToTestInput, stableHash, testInputToRow, type TestCaseRow } from "./test-mapping";
import { hasBlockingIssues, validateForPublish, type PublishIssue } from "./validation";
import {
  progressTransition,
  releasesOnClose,
  shouldAutoClose,
  shouldAutoOpen,
  transition,
  type AssignmentAction,
  type AssignmentState,
} from "./state-machine";

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

type TxClient = Tx;

async function loadAssignmentOrThrow(id: string) {
  const a = await prisma.assignment.findUnique({ where: { id } });
  if (!a) throw new HttpError(404, "assignment_not_found", "Assignment not found");
  return a;
}

async function resolveTopicIds(tx: TxClient, courseId: string, keys: string[]) {
  const unique = [...new Set(keys)];
  if (unique.length === 0) return new Map<string, string>();
  const rows = await tx.topic.findMany({
    where: { courseId, key: { in: unique } },
    select: { id: true, key: true },
  });
  const map = new Map(rows.map((r) => [r.key, r.id]));
  const missing = unique.filter((k) => !map.has(k));
  if (missing.length > 0) {
    throw new HttpError(
      400,
      "unknown_topic",
      `Unknown topic tags for this course: ${missing.join(", ")}`,
    );
  }
  return map;
}

async function resolveObjectiveIds(
  tx: TxClient,
  courseId: string,
  assignmentId: string,
  descriptions: string[],
): Promise<string[]> {
  const ids: string[] = [];
  const existing = await tx.learningObjective.findMany({
    where: { courseId },
    select: { id: true, description: true, order: true, code: true },
  });
  let next = existing.reduce((m, o) => Math.max(m, o.order), 0);
  let n = 0;
  for (const raw of descriptions) {
    const description = raw.trim();
    const found = existing.find(
      (o) => o.description.trim().toLowerCase() === description.toLowerCase(),
    );
    if (found) {
      ids.push(found.id);
      continue;
    }
    n += 1;
    next += 1;
    const created = await tx.learningObjective.create({
      data: {
        courseId,
        code: `A-${assignmentId.slice(-6)}-${n}`,
        description,
        order: next,
      },
      select: { id: true, description: true, order: true, code: true },
    });
    existing.push(created);
    ids.push(created.id);
  }
  return ids;
}

async function writePolicy(
  tx: TxClient,
  a: { id: string; courseId: string; title: string; socraPolicyId: string | null },
  input: AssignmentInput,
  userId: string,
) {
  const p = input.policy;
  const hintLadder = [...p.hintLadder].sort((x, y) => x.level - y.level);
  const data = {
    maxInterventionLevel: p.maxInterventionLevel,
    hintLadder: hintLadder as unknown as Prisma.InputJsonValue,
    allowedBehaviors: p.allowedBehaviors as unknown as Prisma.InputJsonValue,
    forbiddenBehaviors: p.forbiddenBehaviors as unknown as Prisma.InputJsonValue,
    allowDirectSyntaxHelp: p.allowDirectSyntaxHelp,
    allowResourceRetrieval: p.allowResourceRetrieval,
    maxTurnsPerSession: p.maxTurnsPerSession ?? null,
    maxTurnsPerDay: p.maxTurnsPerDay ?? null,
    escalationMessage: p.escalationMessage ?? null,
    notes: p.notes ?? null,
  };
  if (a.socraPolicyId) {
    const policy = await tx.socraPolicy.update({
      where: { id: a.socraPolicyId },
      data: { name: p.name ?? `${a.title} policy` },
      select: { id: true, currentVersionId: true },
    });
    if (policy.currentVersionId) {
      await tx.socraPolicyVersion.update({ where: { id: policy.currentVersionId }, data });
      return policy.id;
    }
    const v = await tx.socraPolicyVersion.create({
      data: { ...data, policyId: policy.id, version: 1, createdById: userId },
    });
    await tx.socraPolicy.update({ where: { id: policy.id }, data: { currentVersionId: v.id } });
    return policy.id;
  }
  const policy = await tx.socraPolicy.create({
    data: { courseId: a.courseId, name: p.name ?? `${a.title} policy` },
  });
  const v = await tx.socraPolicyVersion.create({
    data: { ...data, policyId: policy.id, version: 1, createdById: userId },
  });
  await tx.socraPolicy.update({ where: { id: policy.id }, data: { currentVersionId: v.id } });
  await tx.assignment.update({ where: { id: a.id }, data: { socraPolicyId: policy.id } });
  return policy.id;
}

async function writeQuestion(
  tx: TxClient,
  assignmentId: string,
  order: number,
  q: QuestionInput,
  fallbackLanguage: AssignmentInput["language"],
  topicIds: Map<string, string>,
  userId: string,
  existingId: string | null,
) {
  const language = q.language ?? fallbackLanguage ?? null;
  const versionData = {
    title: q.title,
    prompt: q.prompt,
    type: q.type,
    points: q.points,
    language: q.type === "CODING" ? language : null,
    starterCode: q.starterCode ?? null,
    entryPoint: q.entryPoint ?? null,
    referenceSolution: q.referenceSolution ?? null,
    choices: q.choices ? (q.choices as unknown as Prisma.InputJsonValue) : undefined,
    answerKey:
      q.answerKey === undefined || q.answerKey === null
        ? undefined
        : (q.answerKey as Prisma.InputJsonValue),
    difficulty: q.difficulty,
  };

  let questionId = existingId;
  let versionId: string;
  if (existingId) {
    const existing = await tx.question.findUniqueOrThrow({
      where: { id: existingId },
      select: { currentVersionId: true },
    });
    await tx.question.update({ where: { id: existingId }, data: { order } });
    if (existing.currentVersionId) {
      versionId = existing.currentVersionId;
      await tx.questionVersion.update({ where: { id: versionId }, data: versionData });
    } else {
      const v = await tx.questionVersion.create({
        data: { ...versionData, questionId: existingId, version: 1, createdById: userId },
      });
      versionId = v.id;
      await tx.question.update({ where: { id: existingId }, data: { currentVersionId: v.id } });
    }
  } else {
    const created = await tx.question.create({ data: { assignmentId, order } });
    questionId = created.id;
    const v = await tx.questionVersion.create({
      data: { ...versionData, questionId: created.id, version: 1, createdById: userId },
    });
    versionId = v.id;
    await tx.question.update({ where: { id: created.id }, data: { currentVersionId: v.id } });
  }
  const qid = questionId!;

  // Tests
  await tx.testCase.deleteMany({ where: { questionVersionId: versionId } });
  if (q.tests.length > 0) {
    await tx.testCase.createMany({
      data: q.tests.map((t, i) => {
        const row = testInputToRow(t);
        return {
          questionVersionId: versionId,
          name: t.name,
          visibility: t.visibility,
          weight: t.weight,
          order: i,
          input: row.input as Prisma.InputJsonValue,
          expected: row.expected as Prisma.InputJsonValue,
          harness: row.harness ? (row.harness as Prisma.InputJsonValue) : undefined,
          timeoutMs: t.timeoutMs ?? null,
          failureHint: t.failureHint ?? null,
        };
      }),
    });
  }

  // Scaffold
  await tx.scaffoldStage.deleteMany({ where: { questionVersionId: versionId } });
  if (q.scaffold.length > 0) {
    await tx.scaffoldStage.createMany({
      data: q.scaffold.map((s, i) => ({
        questionVersionId: versionId,
        order: i,
        title: s.title,
        instructions: s.instructions,
        hint: s.hint ?? null,
      })),
    });
  }

  // Topics
  await tx.questionTopic.deleteMany({ where: { questionId: qid } });
  const keys = [...new Set(q.topicKeys)];
  if (keys.length > 0) {
    await tx.questionTopic.createMany({
      data: keys.map((k) => ({
        questionId: qid,
        topicId: topicIds.get(k)!,
        weight: 1 / keys.length,
      })),
    });
  }

  // Rubric (question level)
  const rubric = await tx.rubric.findFirst({ where: { questionId: qid }, select: { id: true } });
  if (q.rubric.length === 0) {
    if (rubric) await tx.rubric.delete({ where: { id: rubric.id } });
  } else {
    const rubricId =
      rubric?.id ??
      (
        await tx.rubric.create({
          data: { assignmentId, questionId: qid, title: `${q.title} rubric` },
          select: { id: true },
        })
      ).id;
    await tx.rubricCriterion.deleteMany({ where: { rubricId } });
    await tx.rubricCriterion.createMany({
      data: q.rubric.map((c, i) => ({
        rubricId,
        order: i,
        title: c.title,
        description: c.description,
        maxPoints: c.maxPoints,
      })),
    });
  }
  return qid;
}

/** Replace the authored content of a DRAFT/SCHEDULED assignment with `input`. */
async function writeAssignmentContent(
  tx: TxClient,
  assignmentId: string,
  input: AssignmentInput,
  userId: string,
) {
  const a = await tx.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
  const allKeys = [...input.topicKeys, ...input.questions.flatMap((q) => q.topicKeys)];
  const topicIds = await resolveTopicIds(tx, a.courseId, allKeys);
  const objectiveIds = await resolveObjectiveIds(
    tx,
    a.courseId,
    assignmentId,
    input.learningObjectives,
  );

  if (input.resourceIds.length > 0) {
    const ok = await tx.courseResource.count({
      where: { id: { in: input.resourceIds }, courseId: a.courseId },
    });
    if (ok !== new Set(input.resourceIds).size) {
      throw new HttpError(
        400,
        "unknown_resource",
        "One or more resources do not belong to this course",
      );
    }
  }

  await tx.assignmentTopic.deleteMany({ where: { assignmentId } });
  const uniqueTopics = [...new Set(input.topicKeys)];
  if (uniqueTopics.length > 0) {
    await tx.assignmentTopic.createMany({
      data: uniqueTopics.map((k) => ({ assignmentId, topicId: topicIds.get(k)! })),
    });
  }
  await tx.assignmentLearningObjective.deleteMany({ where: { assignmentId } });
  if (objectiveIds.length > 0) {
    await tx.assignmentLearningObjective.createMany({
      data: [...new Set(objectiveIds)].map((objectiveId) => ({ assignmentId, objectiveId })),
    });
  }
  await tx.assignmentResource.deleteMany({ where: { assignmentId } });
  if (input.resourceScope === "SELECTED_RESOURCES" && input.resourceIds.length > 0) {
    await tx.assignmentResource.createMany({
      data: [...new Set(input.resourceIds)].map((resourceId) => ({ assignmentId, resourceId })),
    });
  }

  // Questions: keep ids the client sent that belong to this assignment; delete the rest.
  const existing = await tx.question.findMany({ where: { assignmentId }, select: { id: true } });
  const existingIds = new Set(existing.map((e) => e.id));
  const keep = new Set(
    input.questions.map((q) => q.id).filter((id): id is string => !!id && existingIds.has(id)),
  );
  const toDelete = existing.filter((e) => !keep.has(e.id)).map((e) => e.id);
  if (toDelete.length > 0) await tx.question.deleteMany({ where: { id: { in: toDelete } } });
  for (const [i, q] of input.questions.entries()) {
    await writeQuestion(
      tx,
      assignmentId,
      i,
      q,
      input.language,
      topicIds,
      userId,
      q.id && existingIds.has(q.id) ? q.id : null,
    );
  }

  const totalPoints = input.questions.reduce((s, q) => s + q.points, 0);
  await tx.assignment.update({
    where: { id: assignmentId },
    data: {
      title: input.title,
      description: input.description,
      format: input.format,
      language: input.language ?? null,
      openAt: input.openAt ?? null,
      dueAt: input.dueAt ?? null,
      closeAt: input.closeAt ?? null,
      attemptLimit: input.attemptLimit ?? null,
      allowResubmission: input.allowResubmission,
      solutionReleaseMode: input.solutionReleaseMode,
      resourceScope: input.resourceScope,
      totalPoints,
    },
  });
  await writePolicy(
    tx,
    { id: a.id, courseId: a.courseId, title: input.title, socraPolicyId: a.socraPolicyId },
    input,
    userId,
  );
}

async function recordAiSuggestion(
  tx: TxClient,
  user: Principal,
  assignment: { id: string; courseId: string },
  suggestionId: string,
) {
  const s = await tx.authoringSuggestion.findFirst({
    where: { id: suggestionId, courseId: assignment.courseId, createdById: user.id },
  });
  if (!s) return;
  await writeEvent(tx, {
    eventName: "assignment_ai_generated",
    actorId: user.id,
    courseId: assignment.courseId,
    assignmentId: assignment.id,
    idempotencyKey: `assignment_ai_generated:${suggestionId}:${assignment.id}`,
    metadata: { suggestionId, kind: s.kind, aiRequestId: s.aiRequestId ?? undefined },
  });
  await tx.authoringSuggestion.update({
    where: { id: s.id },
    data: {
      assignmentId: assignment.id,
      status: s.status === "PENDING" ? "ACCEPTED" : s.status,
      resolvedAt: s.resolvedAt ?? new Date(),
    },
  });
  await tx.assignment.update({ where: { id: assignment.id }, data: { aiGenerated: true } });
}

// ---------------------------------------------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------------------------------------------

export async function createAssignment(user: CurrentUser, raw: unknown): Promise<{ id: string }> {
  const input = assignmentInputSchema.parse(raw);
  assertCan(user, "assignment:create", { courseId: input.courseId });
  const id = await prisma.$transaction(async (tx) => {
    const created = await tx.assignment.create({
      data: {
        courseId: input.courseId,
        title: input.title,
        format: input.format,
        createdById: user.id,
        aiGenerated: !!input.aiSuggestionId,
      },
    });
    await writeAssignmentContent(tx, created.id, input, user.id);
    await writeEvent(tx, {
      eventName: "assignment_created",
      actorId: user.id,
      courseId: input.courseId,
      assignmentId: created.id,
      idempotencyKey: `assignment_created:${created.id}`,
      metadata: { format: input.format, aiGenerated: !!input.aiSuggestionId },
    });
    if (input.aiSuggestionId) {
      await recordAiSuggestion(
        tx,
        user,
        { id: created.id, courseId: input.courseId },
        input.aiSuggestionId,
      );
    }
    await writeAudit(
      {
        actorId: user.id,
        action: "assignment.create",
        targetType: "Assignment",
        targetId: created.id,
        courseId: input.courseId,
      },
      tx,
    );
    return created.id;
  });
  return { id };
}

/**
 * DRAFT/SCHEDULED: full content update. PUBLISHED/CLOSED: only dates, attempts and release mode (the published
 * AssignmentVersion snapshot is immutable). ARCHIVED: rejected.
 */
export async function updateAssignment(
  user: CurrentUser,
  id: string,
  raw: unknown,
): Promise<{ id: string }> {
  const a = await loadAssignmentOrThrow(id);
  assertCan(user, "assignment:update", { courseId: a.courseId });
  if (a.state === "DRAFT" || a.state === "SCHEDULED") {
    const input = assignmentInputSchema.parse({ ...(raw as object), courseId: a.courseId });
    await prisma.$transaction(async (tx) => {
      await writeAssignmentContent(tx, id, input, user.id);
      if (input.aiSuggestionId) {
        await recordAiSuggestion(tx, user, { id, courseId: a.courseId }, input.aiSuggestionId);
      }
      await writeAudit(
        {
          actorId: user.id,
          action: "assignment.update",
          targetType: "Assignment",
          targetId: id,
          courseId: a.courseId,
        },
        tx,
      );
    });
    return { id };
  }
  if (a.state === "ARCHIVED")
    throw new HttpError(409, "assignment_archived", "Archived assignments cannot be edited");
  const patch = assignmentScheduleUpdateSchema.parse(raw);
  const data: Prisma.AssignmentUpdateInput = {};
  if (patch.openAt !== undefined) data.openAt = patch.openAt;
  if (patch.dueAt !== undefined) data.dueAt = patch.dueAt;
  if (patch.closeAt !== undefined) data.closeAt = patch.closeAt;
  if (patch.attemptLimit !== undefined) data.attemptLimit = patch.attemptLimit ?? null;
  if (patch.allowResubmission !== undefined) data.allowResubmission = patch.allowResubmission;
  if (patch.solutionReleaseMode !== undefined) data.solutionReleaseMode = patch.solutionReleaseMode;
  await prisma.$transaction(async (tx) => {
    await tx.assignment.update({ where: { id }, data });
    await writeAudit(
      {
        actorId: user.id,
        action: "assignment.update",
        targetType: "Assignment",
        targetId: id,
        courseId: a.courseId,
        reason: "schedule/attempt settings changed after publish",
        metadata: JSON.parse(JSON.stringify(patch)) as Prisma.InputJsonValue,
      },
      tx,
    );
  });
  return { id };
}

// ---------------------------------------------------------------------------------------------------------------
// Read for editing / listing
// ---------------------------------------------------------------------------------------------------------------

const questionInclude = {
  currentVersion: {
    include: {
      testCases: { orderBy: { order: "asc" as const } },
      scaffold: { orderBy: { order: "asc" as const } },
    },
  },
  topics: { include: { topic: { select: { key: true } } } },
  rubrics: { include: { criteria: { orderBy: { order: "asc" as const } } } },
} satisfies Prisma.QuestionInclude;

export interface AssignmentEditModel {
  meta: {
    id: string;
    state: AssignmentState;
    courseId: string;
    solutionsReleased: boolean;
    aiGenerated: boolean;
    publishedAt: string | null;
    closedAt: string | null;
    currentVersion: number | null;
    createdAt: string;
  };
  input: AssignmentInputSerialized;
}

/** AssignmentInput with dates as ISO strings (what the form and the API exchange). */
export type AssignmentInputSerialized = Omit<
  AssignmentInput,
  "openAt" | "dueAt" | "closeAt" | "aiSuggestionId"
> & {
  openAt: string | null;
  dueAt: string | null;
  closeAt: string | null;
};

/** Full authoring model including hidden tests and reference solutions. Staff only. */
export async function getAssignmentForEdit(
  user: CurrentUser,
  id: string,
): Promise<AssignmentEditModel> {
  const a = await prisma.assignment.findUnique({
    where: { id },
    include: {
      questions: { orderBy: { order: "asc" }, include: questionInclude },
      topics: { include: { topic: { select: { key: true } } } },
      objectives: { include: { objective: { select: { description: true, order: true } } } },
      resources: { select: { resourceId: true } },
      socraPolicy: { include: { currentVersion: true } },
      currentVersion: { select: { version: true } },
    },
  });
  if (!a) throw new HttpError(404, "assignment_not_found", "Assignment not found");
  assertCan(user, "assignment:read_staff", { courseId: a.courseId });
  assertCan(user, "assignment:hidden_tests:read", { courseId: a.courseId });
  const pv = a.socraPolicy?.currentVersion;
  const input: AssignmentInputSerialized = {
    courseId: a.courseId,
    title: a.title,
    description: a.description,
    format: a.format,
    language: a.language,
    openAt: a.openAt?.toISOString() ?? null,
    dueAt: a.dueAt?.toISOString() ?? null,
    closeAt: a.closeAt?.toISOString() ?? null,
    attemptLimit: a.attemptLimit,
    allowResubmission: a.allowResubmission,
    solutionReleaseMode: a.solutionReleaseMode,
    resourceScope: a.resourceScope,
    resourceIds: a.resources.map((r) => r.resourceId),
    learningObjectives: a.objectives
      .sort((x, y) => x.objective.order - y.objective.order)
      .map((o) => o.objective.description),
    topicKeys: a.topics.map((t) => t.topic.key),
    questions: a.questions.map((q) => {
      const v = q.currentVersion;
      return {
        id: q.id,
        title: v?.title ?? "",
        prompt: v?.prompt ?? "",
        type: v?.type ?? "CODING",
        points: v?.points ?? 0,
        language: v?.language ?? null,
        starterCode: v?.starterCode ?? null,
        entryPoint: v?.entryPoint ?? null,
        referenceSolution: v?.referenceSolution ?? null,
        choices: (v?.choices as string[] | null) ?? null,
        answerKey: v?.answerKey ?? undefined,
        difficulty: v?.difficulty ?? 2,
        topicKeys: q.topics.map((t) => t.topic.key),
        tests: (v?.testCases ?? []).map((t) =>
          rowToTestInput(t as unknown as TestCaseRow, v?.entryPoint),
        ),
        rubric: (q.rubrics[0]?.criteria ?? []).map((c) => ({
          id: c.id,
          title: c.title,
          description: c.description,
          maxPoints: c.maxPoints,
        })),
        scaffold: (v?.scaffold ?? []).map((s) => ({
          title: s.title,
          instructions: s.instructions,
          hint: s.hint ?? undefined,
        })),
      };
    }),
    policy: {
      name: a.socraPolicy?.name,
      maxInterventionLevel: pv?.maxInterventionLevel ?? 5,
      hintLadder:
        (pv?.hintLadder as Array<{ level: number; guidance: string }> | undefined) ??
        DEFAULT_HINT_LADDER,
      allowedBehaviors: (pv?.allowedBehaviors as string[] | undefined) ?? DEFAULT_ALLOWED_BEHAVIORS,
      forbiddenBehaviors:
        (pv?.forbiddenBehaviors as string[] | undefined) ?? DEFAULT_FORBIDDEN_BEHAVIORS,
      allowDirectSyntaxHelp: pv?.allowDirectSyntaxHelp ?? true,
      allowResourceRetrieval: pv?.allowResourceRetrieval ?? true,
      maxTurnsPerSession: pv?.maxTurnsPerSession ?? null,
      maxTurnsPerDay: pv?.maxTurnsPerDay ?? null,
      escalationMessage: pv?.escalationMessage ?? null,
      notes: pv?.notes ?? null,
    },
  };
  return {
    meta: {
      id: a.id,
      state: a.state,
      courseId: a.courseId,
      solutionsReleased: a.solutionsReleased,
      aiGenerated: a.aiGenerated,
      publishedAt: a.publishedAt?.toISOString() ?? null,
      closedAt: a.closedAt?.toISOString() ?? null,
      currentVersion: a.currentVersion?.version ?? null,
      createdAt: a.createdAt.toISOString(),
    },
    input,
  };
}

export interface FacultyAssignmentRow {
  id: string;
  courseId: string;
  courseCode: string;
  title: string;
  format: "CODING" | "WRITTEN" | "QUIZ";
  state: AssignmentState;
  dueAt: Date | null;
  closeAt: Date | null;
  totalPoints: number;
  questionCount: number;
  enrolledCount: number;
  startedCount: number;
  submittedCount: number;
  gradedCount: number;
  solutionsReleased: boolean;
  updatedAt: Date;
}

export async function listAssignmentsForFaculty(
  user: CurrentUser,
  opts: { courseId?: string; includeArchived?: boolean } = {},
): Promise<FacultyAssignmentRow[]> {
  const courseIds = user.memberships
    .filter((m) => m.status === "ACTIVE" && (m.role === "INSTRUCTOR" || m.role === "TA"))
    .map((m) => m.courseId)
    .filter((c) => !opts.courseId || c === opts.courseId);
  if (courseIds.length === 0) return [];
  const rows = await prisma.assignment.findMany({
    where: {
      courseId: { in: courseIds },
      // Archived assignments (for example finished test fixtures) are hidden unless asked for.
      ...(opts.includeArchived ? {} : { state: { not: "ARCHIVED" } }),
    },
    orderBy: [{ updatedAt: "desc" }],
    include: { course: { select: { code: true } }, _count: { select: { questions: true } } },
  });
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [enrolled, progress] = await Promise.all([
    prisma.courseMembership.groupBy({
      by: ["courseId"],
      where: { courseId: { in: courseIds }, role: "STUDENT", status: "ACTIVE" },
      _count: { _all: true },
    }),
    prisma.assignmentProgress.groupBy({
      by: ["assignmentId", "status"],
      where: { assignmentId: { in: ids } },
      _count: { _all: true },
    }),
  ]);
  const gradedByAssignment = await prisma.submission.groupBy({
    by: ["assignmentId"],
    where: { assignmentId: { in: ids }, status: { in: ["GRADED", "RETURNED"] } },
    _count: { _all: true },
  });
  const enrolledBy = new Map(enrolled.map((e) => [e.courseId, e._count._all]));
  return rows.map((r) => {
    const p = progress.filter((x) => x.assignmentId === r.id);
    const count = (...s: string[]) =>
      p.filter((x) => s.includes(x.status)).reduce((n, x) => n + x._count._all, 0);
    return {
      id: r.id,
      courseId: r.courseId,
      courseCode: r.course.code,
      title: r.title,
      format: r.format,
      state: r.state,
      dueAt: r.dueAt,
      closeAt: r.closeAt,
      totalPoints: r.totalPoints,
      questionCount: r._count.questions,
      enrolledCount: enrolledBy.get(r.courseId) ?? 0,
      startedCount: count("IN_PROGRESS", "SUBMITTED", "RETURNED", "CLOSED"),
      submittedCount: count("SUBMITTED", "RETURNED"),
      gradedCount: gradedByAssignment.find((g) => g.assignmentId === r.id)?._count._all ?? 0,
      solutionsReleased: r.solutionsReleased,
      updatedAt: r.updatedAt,
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Publish review
// ---------------------------------------------------------------------------------------------------------------

export interface PublishReview {
  assignmentId: string;
  state: AssignmentState;
  audience: string;
  openAt: string | null;
  dueAt: string | null;
  closeAt: string | null;
  attempts: string;
  totalPoints: number;
  questionCount: number;
  protectedMode: string;
  grading: string;
  analyticsMode: string;
  solutionRelease: string;
  willSchedule: boolean;
  issues: PublishIssue[];
  canPublish: boolean;
}

export async function getPublishReview(user: CurrentUser, id: string): Promise<PublishReview> {
  const model = await getAssignmentForEdit(user, id);
  const i = model.input;
  const parsed = assignmentInputSchema.parse(i);
  const issues = validateForPublish(parsed);
  const enrolled = await prisma.courseMembership.count({
    where: { courseId: i.courseId, role: "STUDENT", status: "ACTIVE" },
  });
  const course = await prisma.course.findUniqueOrThrow({
    where: { id: i.courseId },
    select: { code: true },
  });
  const gradingParts = i.questions.map((q) => {
    if (q.type === "CODING") {
      return q.rubric.length > 0
        ? "Tests run automatically; rubric criteria need your scoring"
        : "Tests run automatically and set the score";
    }
    return "Faculty approves the final score";
  });
  const unique = [...new Set(gradingParts)];
  const now = Date.now();
  const willSchedule = !!(parsed.openAt && parsed.openAt.getTime() > now);
  return {
    assignmentId: id,
    state: model.meta.state,
    audience: `${enrolled} enrolled student${enrolled === 1 ? "" : "s"} in ${course.code}`,
    openAt: i.openAt,
    dueAt: i.dueAt,
    closeAt: i.closeAt,
    attempts: i.attemptLimit
      ? `${i.attemptLimit} attempt${i.attemptLimit === 1 ? "" : "s"}${i.allowResubmission ? "" : ", no resubmission"}`
      : i.allowResubmission
        ? "Unlimited attempts"
        : "One attempt",
    totalPoints: parsed.questions.reduce((s, q) => s + q.points, 0),
    questionCount: i.questions.length,
    protectedMode: `Protected assistance until close (up to L${i.policy.maxInterventionLevel}). Submitting does not unlock solutions.`,
    grading: unique.join("; ") || "No questions yet",
    analyticsMode:
      "Aggregate, class-level analytics only. Faculty cannot read student conversations.",
    solutionRelease:
      i.solutionReleaseMode === "NEVER"
        ? "Solutions are never released"
        : i.solutionReleaseMode === "ON_CLOSE"
          ? "Released automatically when the assignment closes"
          : "Released manually after you close the assignment",
    willSchedule,
    issues,
    canPublish:
      (model.meta.state === "DRAFT" || model.meta.state === "SCHEDULED") &&
      !hasBlockingIssues(issues),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------------------------

function assertTransition(
  state: AssignmentState,
  action: AssignmentAction,
  solutionsReleased: boolean,
) {
  const t = transition(state, action, { solutionsReleased });
  if (!t.ok) throw new HttpError(409, "invalid_transition", t.reason);
  return t;
}

export async function publishAssignment(
  user: CurrentUser,
  id: string,
  opts: { changeNote?: string } = {},
): Promise<{ id: string; state: AssignmentState; version: number; versionId: string }> {
  const a = await loadAssignmentOrThrow(id);
  assertCan(user, "assignment:publish", { courseId: a.courseId });
  const model = await getAssignmentForEdit(user, id);
  const issues = validateForPublish(assignmentInputSchema.parse(model.input));
  if (hasBlockingIssues(issues)) {
    throw new HttpError(
      422,
      "publish_blocked",
      "Fix the listed problems before publishing",
      issues.filter((i) => i.severity === "error"),
    );
  }
  const schedule = !!(a.openAt && a.openAt.getTime() > Date.now());
  // DRAFT can schedule or publish; a SCHEDULED assignment may be republished (stays scheduled while openAt is future).
  assertTransition(
    a.state,
    a.state === "DRAFT" && schedule ? "schedule" : "publish",
    a.solutionsReleased,
  );
  const targetState: AssignmentState = schedule ? "SCHEDULED" : "PUBLISHED_PROTECTED";

  return prisma.$transaction(async (tx) => {
    const policyVersion = a.socraPolicyId
      ? await tx.socraPolicy.findUnique({
          where: { id: a.socraPolicyId },
          select: { currentVersionId: true, currentVersion: { select: { version: true } } },
        })
      : null;
    const snapshot = JSON.parse(
      JSON.stringify({
        ...model.input,
        policyVersion: policyVersion?.currentVersion?.version ?? null,
      }),
    ) as Prisma.InputJsonObject;
    const questions = await tx.question.findMany({
      where: { assignmentId: id },
      orderBy: { order: "asc" },
      select: { id: true, currentVersionId: true, currentVersion: { select: { version: true } } },
    });
    (snapshot as Record<string, unknown>).questionVersions = questions.map((q) => ({
      questionId: q.id,
      questionVersionId: q.currentVersionId,
      version: q.currentVersion?.version ?? 1,
    }));
    const last = await tx.assignmentVersion.findFirst({
      where: { assignmentId: id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;
    const now = new Date();
    const v = await tx.assignmentVersion.create({
      data: {
        assignmentId: id,
        version,
        snapshot,
        snapshotHash: stableHash(snapshot),
        policyVersionId: policyVersion?.currentVersionId ?? null,
        changeNote: opts.changeNote ?? null,
        createdById: user.id,
        publishedAt: now,
      },
    });
    await tx.assignment.update({
      where: { id },
      data: { state: targetState, currentVersionId: v.id, publishedAt: a.publishedAt ?? now },
    });
    await writeEvent(tx, {
      eventName: "assignment_published",
      actorId: user.id,
      courseId: a.courseId,
      assignmentId: id,
      assignmentVersion: version,
      idempotencyKey: `assignment_published:${v.id}`,
      metadata: { versionId: v.id },
    });
    await writeAudit(
      {
        actorId: user.id,
        action: "assignment.publish",
        targetType: "Assignment",
        targetId: id,
        courseId: a.courseId,
        metadata: { version, state: targetState },
      },
      tx,
    );
    return { id, state: targetState, version, versionId: v.id };
  });
}

async function currentVersionNumber(tx: TxClient, assignmentId: string): Promise<number> {
  const v = await tx.assignmentVersion.findFirst({
    where: { assignmentId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return v?.version ?? 1;
}

async function closeInternal(
  tx: TxClient,
  a: {
    id: string;
    courseId: string;
    state: AssignmentState;
    solutionsReleased: boolean;
    solutionReleaseMode: "NEVER" | "ON_CLOSE" | "MANUAL";
  },
  actorId: string | null,
  trigger: "schedule" | "faculty" | "admin",
) {
  const t = transition(a.state, "close", { solutionsReleased: a.solutionsReleased });
  if (!t.ok) throw new HttpError(409, "invalid_transition", t.reason);
  const now = new Date();
  const autoRelease =
    releasesOnClose(a.solutionReleaseMode) &&
    (await isEnabled("postAssessmentSolutions", { courseId: a.courseId }, tx));
  const res = await tx.assignment.updateMany({
    where: { id: a.id, state: a.state },
    data: {
      state: "CLOSED",
      closedAt: now,
      ...(autoRelease ? { solutionsReleased: true, solutionsReleasedAt: now } : {}),
    },
  });
  if (res.count === 0) return false;
  // Per-student progress: everyone not yet returned becomes CLOSED.
  await tx.assignmentProgress.updateMany({
    where: { assignmentId: a.id, status: { in: ["NOT_STARTED", "IN_PROGRESS", "SUBMITTED"] } },
    data: { status: progressTransition("SUBMITTED", "assignmentClosed") },
  });
  const version = await currentVersionNumber(tx, a.id);
  await writeEvent(tx, {
    eventName: "assignment_closed",
    actorId,
    courseId: a.courseId,
    assignmentId: a.id,
    assignmentVersion: version,
    idempotencyKey: `assignment_closed:${a.id}:${now.getTime()}`,
    metadata: { trigger },
  });
  await writeAudit(
    {
      actorId,
      action: "assignment.close",
      targetType: "Assignment",
      targetId: a.id,
      courseId: a.courseId,
      metadata: { trigger, solutionsReleased: autoRelease },
    },
    tx,
  );
  if (autoRelease) {
    await writeEvent(tx, {
      eventName: "solutions_released",
      actorId,
      courseId: a.courseId,
      assignmentId: a.id,
      assignmentVersion: version,
      idempotencyKey: `solutions_released:${a.id}:${now.getTime()}`,
      metadata: {},
    });
    await writeAudit(
      {
        actorId,
        action: "assignment.solutions_release",
        targetType: "Assignment",
        targetId: a.id,
        courseId: a.courseId,
        metadata: { mode: "ON_CLOSE" },
      },
      tx,
    );
  }
  return true;
}

export async function closeAssignment(
  user: CurrentUser,
  id: string,
): Promise<{ id: string; state: AssignmentState }> {
  const a = await loadAssignmentOrThrow(id);
  assertCan(user, "assignment:close", { courseId: a.courseId });
  const trigger =
    user.roles.includes("SYSTEM_ADMIN") &&
    !user.memberships.some((m) => m.courseId === a.courseId && m.role === "INSTRUCTOR")
      ? "admin"
      : "faculty";
  await prisma.$transaction((tx) => closeInternal(tx, a, user.id, trigger));
  return { id, state: "CLOSED" };
}

export async function reopenAssignment(
  user: CurrentUser,
  id: string,
  input: { reason: string; closeAt?: Date | null },
): Promise<{ id: string; state: AssignmentState }> {
  const a = await loadAssignmentOrThrow(id);
  assertCan(user, "assignment:reopen", { courseId: a.courseId });
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5)
    throw new HttpError(
      400,
      "reason_required",
      "Give a reason for reopening (at least 5 characters)",
    );
  const t = assertTransition(a.state, "reopen", a.solutionsReleased);
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const newClose =
      input.closeAt !== undefined
        ? input.closeAt
        : a.closeAt && a.closeAt <= now
          ? null
          : a.closeAt;
    await tx.assignment.update({
      where: { id },
      data: {
        state: t.state,
        closedAt: null,
        closeAt: newClose,
        ...(t.effects.solutionsReleased === false
          ? { solutionsReleased: false, solutionsReleasedAt: null }
          : {}),
      },
    });
    // Restore per-student progress from the facts on the row.
    await tx.assignmentProgress.updateMany({
      where: { assignmentId: id, status: "CLOSED", latestSubmissionId: { not: null } },
      data: { status: "SUBMITTED" },
    });
    await tx.assignmentProgress.updateMany({
      where: { assignmentId: id, status: "CLOSED", latestSubmissionId: null },
      data: { status: "IN_PROGRESS" },
    });
    await writeEvent(tx, {
      eventName: "assignment_reopened",
      actorId: user.id,
      courseId: a.courseId,
      assignmentId: id,
      assignmentVersion: await currentVersionNumber(tx, id),
      idempotencyKey: `assignment_reopened:${id}:${now.getTime()}`,
      metadata: { reason },
    });
    await writeAudit(
      {
        actorId: user.id,
        action: "assignment.reopen",
        targetType: "Assignment",
        targetId: id,
        courseId: a.courseId,
        reason,
        metadata: {
          revokedSolutionRelease: a.solutionsReleased,
          newCloseAt: newClose?.toISOString() ?? null,
        },
      },
      tx,
    );
  });
  return { id, state: "PUBLISHED_PROTECTED" };
}

export async function releaseSolutions(
  user: CurrentUser,
  id: string,
): Promise<{ id: string; solutionsReleased: true }> {
  const a = await loadAssignmentOrThrow(id);
  assertCan(user, "assignment:release_solutions", { courseId: a.courseId });
  assertTransition(a.state, "releaseSolutions", a.solutionsReleased);
  if (a.solutionReleaseMode === "NEVER") {
    throw new HttpError(
      409,
      "solutions_never_released",
      "This assignment is set to never release solutions",
    );
  }
  if (!(await isEnabled("postAssessmentSolutions", { courseId: a.courseId }))) {
    throw new HttpError(
      409,
      "feature_disabled",
      "Post-assessment solutions are turned off for this course",
    );
  }
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.assignment.update({
      where: { id },
      data: { solutionsReleased: true, solutionsReleasedAt: now },
    });
    await writeEvent(tx, {
      eventName: "solutions_released",
      actorId: user.id,
      courseId: a.courseId,
      assignmentId: id,
      assignmentVersion: await currentVersionNumber(tx, id),
      idempotencyKey: `solutions_released:${id}:${now.getTime()}`,
      metadata: {},
    });
    await writeAudit(
      {
        actorId: user.id,
        action: "assignment.solutions_release",
        targetType: "Assignment",
        targetId: id,
        courseId: a.courseId,
        metadata: { mode: "MANUAL" },
      },
      tx,
    );
  });
  return { id, solutionsReleased: true };
}

export async function archiveAssignment(
  user: CurrentUser,
  id: string,
): Promise<{ id: string; state: AssignmentState }> {
  const a = await loadAssignmentOrThrow(id);
  assertCan(user, "assignment:close", { courseId: a.courseId });
  const t = assertTransition(a.state, "archive", a.solutionsReleased);
  await prisma.$transaction(async (tx) => {
    await tx.assignment.update({ where: { id }, data: { state: t.state, archivedAt: new Date() } });
    await writeAudit(
      {
        actorId: user.id,
        action: "assignment.archive",
        targetType: "Assignment",
        targetId: id,
        courseId: a.courseId,
      },
      tx,
    );
  });
  return { id, state: t.state };
}

/**
 * Lazy scheduled transitions: SCHEDULED -> PUBLISHED_PROTECTED at openAt, PUBLISHED_PROTECTED -> CLOSED at closeAt.
 * Called from reads and submissions so no sweeper job is required for correctness. Returns the up-to-date state.
 */
export async function syncAssignmentState(
  assignmentId: string,
  now: Date = new Date(),
): Promise<AssignmentState> {
  const a = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      courseId: true,
      state: true,
      openAt: true,
      closeAt: true,
      solutionsReleased: true,
      solutionReleaseMode: true,
    },
  });
  if (!a) throw new HttpError(404, "assignment_not_found", "Assignment not found");
  let state = a.state;
  if (shouldAutoOpen(a, now)) {
    const res = await prisma.assignment.updateMany({
      where: { id: a.id, state: "SCHEDULED" },
      data: { state: "PUBLISHED_PROTECTED" },
    });
    if (res.count > 0) state = "PUBLISHED_PROTECTED";
  }
  if (shouldAutoClose({ state, closeAt: a.closeAt }, now)) {
    await prisma.$transaction((tx) => closeInternal(tx, { ...a, state }, null, "schedule"));
    state = "CLOSED";
  }
  return state;
}

export async function syncCourseAssignments(
  courseId: string,
  now: Date = new Date(),
): Promise<void> {
  const due = await prisma.assignment.findMany({
    where: {
      courseId,
      OR: [
        { state: "SCHEDULED", openAt: { lte: now } },
        { state: "PUBLISHED_PROTECTED", closeAt: { lte: now } },
      ],
    },
    select: { id: true },
  });
  for (const d of due) await syncAssignmentState(d.id, now);
}
