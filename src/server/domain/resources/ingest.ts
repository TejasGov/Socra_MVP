import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { ResourceAccessScope, ResourceType } from "@/generated/prisma/enums";
import { writeAudit } from "@/server/audit";
import { assertCan } from "@/server/auth/rbac";
import type { CurrentUser } from "@/server/auth/current-user";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { HttpError } from "@/server/http";
import { getQueue, QUEUE_NAMES } from "@/server/queues";
import { chunkText } from "./chunker";
import { decodeTextBytes, ResourceValidationError, validateText, validateUpload } from "./upload";

export interface IngestResourceInput {
  courseId: string;
  title: string;
  type: ResourceType;
  /** Pasted text. Either `text` or `file` is required. */
  text?: string;
  /** Uploaded file (.txt / .md only). */
  file?: { name: string; size: number; mimeType?: string | null; bytes: Uint8Array };
  topicIds?: string[];
  lecture?: string | null;
  week?: number | null;
  accessScope?: ResourceAccessScope;
  /** Provide to publish a new version of an existing resource (re-chunks and supersedes old chunks). */
  resourceId?: string;
}

export interface IngestResult {
  resourceId: string;
  version: number;
  status: string;
  chunkCount: number;
  embeddingsQueued: boolean;
}

function toHttp(err: unknown): never {
  if (err instanceof ResourceValidationError) throw new HttpError(400, err.code, err.message);
  throw err;
}

export async function ingestResource(
  user: CurrentUser,
  input: IngestResourceInput,
): Promise<IngestResult> {
  assertCan(user, "resource:manage", { courseId: input.courseId });

  let text = "";
  let mimeType = "text/plain";
  let fileName: string | null = null;
  try {
    if (input.file) {
      const v = validateUpload({ ...input.file, size: input.file.bytes.byteLength });
      mimeType = v.mimeType;
      fileName = input.file.name;
      text = validateText(decodeTextBytes(input.file.bytes));
    } else if (input.text !== undefined) {
      text = validateText(input.text);
      if (/^#{1,6}\s/m.test(text)) mimeType = "text/markdown";
    } else {
      throw new ResourceValidationError("no_content", "Paste text or upload a .txt or .md file.");
    }
  } catch (err) {
    toHttp(err);
  }

  const title = input.title.trim();
  if (!title) throw new HttpError(400, "title_required", "Give the resource a title.");
  if (title.length > 200) {
    throw new HttpError(400, "title_too_long", "Title must be 200 characters or fewer.");
  }

  const topicIds = [...new Set(input.topicIds ?? [])];
  if (topicIds.length) {
    const found = await prisma.topic.count({
      where: { id: { in: topicIds }, courseId: input.courseId },
    });
    if (found !== topicIds.length) {
      throw new HttpError(400, "invalid_topics", "One or more topics do not belong to this course.");
    }
  }

  const contentHash = createHash("sha256").update(text).digest("hex");
  const chunks = chunkText(text, { defaultHeading: title });
  const metadata: Record<string, unknown> = {
    ...(fileName ? { fileName } : {}),
    ...(input.lecture ? { lecture: input.lecture } : {}),
    ...(input.week != null ? { week: input.week } : {}),
    charCount: text.length,
  };

  const result = await prisma.$transaction(async (tx) => {
    let resourceId: string;
    let version: number;
    if (input.resourceId) {
      const existing = await tx.courseResource.findUnique({ where: { id: input.resourceId } });
      if (!existing || existing.courseId !== input.courseId) {
        throw new HttpError(404, "resource_not_found", "Resource not found in this course.");
      }
      version = existing.version + 1;
      resourceId = existing.id;
      await tx.courseResource.update({
        where: { id: resourceId },
        data: {
          title,
          type: input.type,
          version,
          status: "PROCESSING",
          textContent: text,
          contentHash,
          mimeType,
          errorMessage: null,
          metadata: {
            ...((existing.metadata as object | null) ?? {}),
            ...metadata,
          } as Prisma.InputJsonValue,
          ...(input.accessScope ? { accessScope: input.accessScope } : {}),
        },
      });
      if (input.topicIds) {
        await tx.courseResourceTopic.deleteMany({ where: { resourceId } });
      }
    } else {
      const created = await tx.courseResource.create({
        data: {
          courseId: input.courseId,
          title,
          type: input.type,
          status: "PROCESSING",
          accessScope: input.accessScope ?? "COURSE_ALL",
          textContent: text,
          contentHash,
          mimeType,
          metadata: metadata as Prisma.InputJsonValue,
          uploadedById: user.id,
        },
      });
      resourceId = created.id;
      version = created.version;
    }

    if (topicIds.length) {
      await tx.courseResourceTopic.createMany({
        data: topicIds.map((topicId) => ({ resourceId, topicId })),
        skipDuplicates: true,
      });
    }

    // Old versions' chunks stay (citations may point at them) but retrieval only reads the current version.
    await tx.resourceChunk.createMany({
      data: chunks.map((c) => ({
        resourceId,
        courseId: input.courseId,
        sourceVersion: version,
        chunkIndex: c.chunkIndex,
        content: c.content,
        headingPath: c.headingPath,
        tokenCount: c.tokenCount,
      })),
    });
    await tx.courseResource.update({ where: { id: resourceId }, data: { status: "READY" } });
    await writeAudit(
      {
        actorId: user.id,
        action: input.resourceId ? "resource.new_version" : "resource.create",
        targetType: "CourseResource",
        targetId: resourceId,
        courseId: input.courseId,
        metadata: { version, chunkCount: chunks.length, contentHash },
      },
      tx,
    );
    return { resourceId, version };
  });

  let embeddingsQueued = false;
  if (!env().AI_MOCK_MODE) {
    try {
      await getQueue(QUEUE_NAMES.embeddings).add(
        "embed-resource",
        { resourceId: result.resourceId, version: result.version },
        { jobId: `embed-${result.resourceId}-v${result.version}` },
      );
      embeddingsQueued = true;
    } catch (err) {
      console.error("[resources] could not enqueue embeddings job", err);
    }
  }

  return {
    resourceId: result.resourceId,
    version: result.version,
    status: "READY",
    chunkCount: chunks.length,
    embeddingsQueued,
  };
}

export async function archiveResource(
  user: CurrentUser,
  courseId: string,
  resourceId: string,
): Promise<void> {
  assertCan(user, "resource:manage", { courseId });
  const res = await prisma.courseResource.findUnique({
    where: { id: resourceId },
    select: { courseId: true },
  });
  if (!res || res.courseId !== courseId) {
    throw new HttpError(404, "resource_not_found", "Resource not found.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.courseResource.update({ where: { id: resourceId }, data: { status: "ARCHIVED" } });
    await writeAudit(
      {
        actorId: user.id,
        action: "resource.archive",
        targetType: "CourseResource",
        targetId: resourceId,
        courseId,
      },
      tx,
    );
  });
}

export interface ResourceListItem {
  id: string;
  title: string;
  type: ResourceType;
  status: string;
  accessScope: ResourceAccessScope;
  version: number;
  chunkCount: number;
  embeddedChunkCount: number;
  topics: Array<{ id: string; name: string }>;
  lecture: string | null;
  week: number | null;
  updatedAt: Date;
}

/** Staff see everything; students only COURSE_ALL READY resources. */
export async function listCourseResources(
  user: CurrentUser,
  courseId: string,
): Promise<ResourceListItem[]> {
  assertCan(user, "resource:read", { courseId });
  const staff = user.memberships.some(
    (m) =>
      m.courseId === courseId &&
      m.status === "ACTIVE" &&
      (m.role === "INSTRUCTOR" || m.role === "TA"),
  );
  const rows = await prisma.courseResource.findMany({
    where: {
      courseId,
      ...(staff ? {} : { status: "READY", accessScope: "COURSE_ALL" }),
    },
    orderBy: { updatedAt: "desc" },
    include: { topics: { include: { topic: { select: { id: true, name: true } } } } },
  });
  const counts = rows.length
    ? await prisma.$queryRaw<Array<{ resourceId: string; total: bigint; embedded: bigint }>>`
        SELECT c."resourceId", count(*) AS total, count(c.embedding) AS embedded
        FROM "ResourceChunk" c
        JOIN "CourseResource" r ON r.id = c."resourceId" AND c."sourceVersion" = r.version
        WHERE c."courseId" = ${courseId}
        GROUP BY c."resourceId"`
    : [];
  const byId = new Map(counts.map((c) => [c.resourceId, c]));
  return rows.map((r) => {
    const meta = (r.metadata ?? {}) as { lecture?: string; week?: number };
    const c = byId.get(r.id);
    return {
      id: r.id,
      title: r.title,
      type: r.type,
      status: r.status,
      accessScope: r.accessScope,
      version: r.version,
      chunkCount: Number(c?.total ?? 0),
      embeddedChunkCount: Number(c?.embedded ?? 0),
      topics: r.topics.map((t) => t.topic),
      lecture: meta.lecture ?? null,
      week: meta.week ?? null,
      updatedAt: r.updatedAt,
    };
  });
}
