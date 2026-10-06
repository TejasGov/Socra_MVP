import "server-only";
import { prisma } from "@/server/db";
import type { CurrentUser } from "@/server/auth/current-user";
import { assertCan } from "@/server/auth/rbac";
import { writeEvent } from "@/server/events";
import { HttpError } from "@/server/http";
import { syncAssignmentState } from "@/server/domain/assignments/service";
import { sha256 } from "@/server/domain/assignments/test-mapping";

export const MAX_DRAFT_BYTES = 200_000;
/** draft_saved is emitted at most once per question per this window; no keystroke events. */
export const DRAFT_EVENT_INTERVAL_MS = 60_000;

export type SaveDraftResult =
  | { ok: true; version: number; savedAt: Date }
  | { ok: false; conflict: { serverVersion: number; content: string; savedAt: Date } };

async function resolveQuestion(assignmentId: string, questionId: string) {
  const q = await prisma.question.findFirst({
    where: { id: questionId, assignmentId },
    select: {
      id: true,
      currentVersion: { select: { version: true, language: true } },
      assignment: {
        select: { courseId: true, language: true, currentVersion: { select: { version: true } } },
      },
    },
  });
  if (!q) throw new HttpError(404, "question_not_found", "Question not found");
  return q;
}

export async function getDraft(user: CurrentUser, assignmentId: string, questionId: string) {
  const q = await resolveQuestion(assignmentId, questionId);
  assertCan(user, "draft:read_own", { courseId: q.assignment.courseId, ownerId: user.id });
  const d = await prisma.draft.findUnique({
    where: { userId_questionId: { userId: user.id, questionId } },
    select: { content: true, version: true, updatedAt: true, language: true },
  });
  return d
    ? { content: d.content, version: d.version, savedAt: d.updatedAt, language: d.language }
    : null;
}

/**
 * Optimistic concurrency: `baseVersion` is the version the client last saw (0 = no draft yet). A mismatch returns the
 * server copy so the client can reconcile. Identical content is a no-op (no version bump).
 */
export async function saveDraft(
  user: CurrentUser,
  input: {
    assignmentId: string;
    questionId: string;
    content: string;
    baseVersion: number;
    clientUpdatedAt?: Date | null;
  },
): Promise<SaveDraftResult> {
  if (Buffer.byteLength(input.content, "utf8") > MAX_DRAFT_BYTES) {
    throw new HttpError(413, "draft_too_large", "Draft is too large to save");
  }
  const q = await resolveQuestion(input.assignmentId, input.questionId);
  assertCan(user, "draft:write_own", { courseId: q.assignment.courseId, ownerId: user.id });
  const state = await syncAssignmentState(input.assignmentId);
  if (state !== "PUBLISHED_PROTECTED") {
    throw new HttpError(409, "assignment_not_open", "This assignment is not open for editing");
  }
  const language = q.currentVersion?.language ?? q.assignment.language ?? null;
  const contentHash = sha256(input.content);
  const assignmentVersion = q.assignment.currentVersion?.version;

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.draft.findUnique({
        where: { userId_questionId: { userId: user.id, questionId: input.questionId } },
      });
      let version: number;
      let savedAt: Date;
      if (!existing) {
        if (input.baseVersion !== 0) {
          // Client thinks a draft exists but it does not (e.g. reset). Treat as a fresh create.
        }
        const created = await tx.draft.create({
          data: {
            userId: user.id,
            assignmentId: input.assignmentId,
            questionId: input.questionId,
            content: input.content,
            language,
            version: 1,
            contentHash,
            clientUpdatedAt: input.clientUpdatedAt ?? null,
          },
        });
        version = created.version;
        savedAt = created.updatedAt;
      } else {
        if (existing.version !== input.baseVersion) {
          if (existing.contentHash === contentHash) {
            return { ok: true as const, version: existing.version, savedAt: existing.updatedAt };
          }
          return {
            ok: false as const,
            conflict: {
              serverVersion: existing.version,
              content: existing.content,
              savedAt: existing.updatedAt,
            },
          };
        }
        if (existing.contentHash === contentHash) {
          return { ok: true as const, version: existing.version, savedAt: existing.updatedAt };
        }
        // Compare-and-set so two concurrent saves from the same base cannot both win.
        const res = await tx.draft.updateMany({
          where: { id: existing.id, version: existing.version },
          data: {
            content: input.content,
            version: existing.version + 1,
            contentHash,
            language,
            clientUpdatedAt: input.clientUpdatedAt ?? null,
          },
        });
        if (res.count === 0) {
          const latest = await tx.draft.findUniqueOrThrow({ where: { id: existing.id } });
          return {
            ok: false as const,
            conflict: {
              serverVersion: latest.version,
              content: latest.content,
              savedAt: latest.updatedAt,
            },
          };
        }
        version = existing.version + 1;
        savedAt = new Date();
      }

      await tx.assignmentProgress.upsert({
        where: { userId_assignmentId: { userId: user.id, assignmentId: input.assignmentId } },
        create: {
          userId: user.id,
          assignmentId: input.assignmentId,
          status: "IN_PROGRESS",
          firstOpenedAt: savedAt,
          lastActivityAt: savedAt,
        },
        update: { lastActivityAt: savedAt },
      });
      await tx.assignmentProgress.updateMany({
        where: { userId: user.id, assignmentId: input.assignmentId, status: "NOT_STARTED" },
        data: { status: "IN_PROGRESS" },
      });
      // A saved edit after submitting a resubmittable assignment moves back to IN_PROGRESS.
      await tx.assignmentProgress.updateMany({
        where: { userId: user.id, assignmentId: input.assignmentId, status: "SUBMITTED" },
        data: { status: "IN_PROGRESS" },
      });

      if (assignmentVersion) {
        const since = new Date(Date.now() - DRAFT_EVENT_INTERVAL_MS);
        const recent = await tx.analyticsEvent.count({
          where: {
            eventName: "draft_saved",
            actorId: user.id,
            questionId: input.questionId,
            occurredAt: { gt: since },
          },
        });
        if (recent === 0) {
          const bucket = Math.floor(Date.now() / DRAFT_EVENT_INTERVAL_MS);
          await writeEvent(tx, {
            eventName: "draft_saved",
            actorId: user.id,
            courseId: q.assignment.courseId,
            assignmentId: input.assignmentId,
            assignmentVersion,
            questionId: input.questionId,
            questionVersion: q.currentVersion?.version,
            idempotencyKey: `draft_saved:${user.id}:${input.questionId}:${bucket}`,
            metadata: {
              draftVersion: version,
              contentHash,
              byteCount: Buffer.byteLength(input.content, "utf8"),
            },
          });
        }
      }
      return { ok: true as const, version, savedAt };
    });
  } catch (err) {
    // Two first-saves racing: the unique (userId, questionId) fires; report as a conflict with the server copy.
    if ((err as { code?: string }).code === "P2002") {
      const latest = await prisma.draft.findUnique({
        where: { userId_questionId: { userId: user.id, questionId: input.questionId } },
      });
      if (latest) {
        return {
          ok: false,
          conflict: {
            serverVersion: latest.version,
            content: latest.content,
            savedAt: latest.updatedAt,
          },
        };
      }
    }
    throw err;
  }
}
