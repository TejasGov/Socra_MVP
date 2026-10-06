import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { writeAudit } from "@/server/audit";
import { loadPrincipal } from "@/server/auth/principal";
import { assertCan, type Principal } from "@/server/auth/rbac";
import { pseudonymFor, writeEvent } from "@/server/events";
import { PSEUDONYM_KEY_VERSION, PSEUDONYM_METHOD } from "@/server/events/pseudonym";
import { HttpError } from "@/server/http";
import { getQueue, QUEUE_NAMES } from "@/server/queues";
import {
  EXPORT_FIELD_KEYS,
  FORBIDDEN_FIELD_HINTS,
  exportRequestSchema,
  validateFields,
  type ExportRequest,
  type ExportSource,
} from "./allowlist";
import { projectRow, serialize, type ExportRow } from "./serialize";
import { getStorage, sha256Hex } from "./storage";

export { exportRequestSchema };

/** Exports with at most this many rows run inline in the request; larger ones go to the exports queue. */
export const INLINE_ROW_LIMIT = 5000;
const BATCH = 2000;
const EXPORT_CODE_VERSION = "research-export-v1";

/** What every manifest declares as never exported. */
const ALWAYS_EXCLUDED = [
  "names",
  "email addresses",
  "internal user ids",
  "session ids",
  "raw message content",
  "code and answer content",
  "hidden tests",
];

interface StoredFilters {
  courseId?: string;
  assignmentId?: string;
  from?: string;
  to?: string;
  eventNames?: string[];
}

function filtersOf(input: ExportRequest): StoredFilters {
  return {
    ...(input.courseId ? { courseId: input.courseId } : {}),
    ...(input.assignmentId ? { assignmentId: input.assignmentId } : {}),
    ...(input.from ? { from: input.from.toISOString() } : {}),
    ...(input.to ? { to: input.to.toISOString() } : {}),
    ...(input.eventNames?.length ? { eventNames: input.eventNames } : {}),
  };
}

/** Throws 400 naming every disallowed field. */
export function assertFieldsAllowed(fields: readonly string[]): void {
  const v = validateFields(fields);
  if (v.rejected.length > 0) {
    const personal = v.rejected.filter((f) =>
      FORBIDDEN_FIELD_HINTS.some((h) => f.toLowerCase().includes(h.toLowerCase())),
    );
    throw new HttpError(
      400,
      "field_not_allowed",
      `These fields cannot be exported: ${v.rejected.join(", ")}.${
        personal.length ? " Names, emails, identifiers and raw content are never exportable." : ""
      }`,
      { rejected: v.rejected, allowed: EXPORT_FIELD_KEYS },
    );
  }
  if (!v.ok) throw new HttpError(400, "no_fields", "Choose at least one field");
  if (v.duplicates.length > 0) {
    throw new HttpError(400, "duplicate_fields", `Duplicate fields: ${v.duplicates.join(", ")}`);
  }
}

async function eligibleParticipants(courseId?: string) {
  const rows = await prisma.studyParticipant.findMany({
    where: {
      withdrawnAt: null,
      consentStatus: { notIn: ["DECLINED", "WITHDRAWN"] },
      ...(courseId ? { courseId } : {}),
    },
    select: { userId: true, courseId: true, condition: true },
  });
  return new Map(rows.map((r) => [`${r.userId}:${r.courseId}`, r]));
}

function eventWhere(f: StoredFilters, userIds: string[]): Prisma.AnalyticsEventWhereInput {
  return {
    status: "ACCEPTED",
    actorId: { in: userIds },
    courseId: f.courseId ? f.courseId : { not: null },
    ...(f.assignmentId ? { assignmentId: f.assignmentId } : {}),
    ...(f.from || f.to
      ? {
          occurredAt: {
            ...(f.from ? { gte: new Date(f.from) } : {}),
            ...(f.to ? { lt: new Date(f.to) } : {}),
          },
        }
      : {}),
    eventName: f.eventNames?.length
      ? { in: f.eventNames.filter((n) => !n.startsWith("research_")) }
      : { not: { startsWith: "research_" } },
  };
}

async function countRows(f: StoredFilters): Promise<number> {
  const participants = await eligibleParticipants(f.courseId);
  const userIds = [...new Set([...participants.values()].map((p) => p.userId))];
  if (userIds.length === 0) return 0;
  return prisma.analyticsEvent.count({ where: eventWhere(f, userIds) });
}

interface BuiltExport {
  rows: ExportRow[];
  modelVersions: string[];
  promptVersions: string[];
  conditionCounts: Record<string, number>;
}

async function buildRows(f: StoredFilters, fields: readonly string[]): Promise<BuiltExport> {
  const participants = await eligibleParticipants(f.courseId);
  const userIds = [...new Set([...participants.values()].map((p) => p.userId))];
  const rows: ExportRow[] = [];
  const models = new Set<string>();
  const prompts = new Set<string>();
  const conditionCounts: Record<string, number> = {};
  if (userIds.length === 0) {
    return { rows, modelVersions: [], promptVersions: [], conditionCounts };
  }
  const where = eventWhere(f, userIds);
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.analyticsEvent.findMany({
      where,
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        eventName: true,
        actorId: true,
        courseId: true,
        assignmentId: true,
        assignmentVersion: true,
        questionId: true,
        questionVersion: true,
        schemaVersion: true,
        appVersion: true,
        occurredAt: true,
        researchCondition: true,
        metadata: true,
      },
    });
    if (batch.length === 0) break;
    for (const e of batch) {
      const p =
        e.actorId && e.courseId ? participants.get(`${e.actorId}:${e.courseId}`) : undefined;
      if (!p || !e.actorId) continue; // not a consenting participant in that course
      const metadata =
        e.metadata !== null && typeof e.metadata === "object" && !Array.isArray(e.metadata)
          ? (e.metadata as Record<string, unknown>)
          : {};
      const source: ExportSource = {
        participantId: pseudonymFor(e.actorId),
        condition: e.researchCondition ?? p.condition,
        eventId: e.id,
        eventName: e.eventName,
        occurredAt: e.occurredAt,
        courseId: e.courseId,
        assignmentId: e.assignmentId,
        assignmentVersion: e.assignmentVersion,
        questionId: e.questionId,
        questionVersion: e.questionVersion,
        schemaVersion: e.schemaVersion,
        appVersion: e.appVersion,
        metadata,
      };
      rows.push(projectRow(fields, source));
      if (typeof metadata.model === "string") models.add(metadata.model.slice(0, 120));
      if (typeof metadata.promptVersion === "string")
        prompts.add(metadata.promptVersion.slice(0, 120));
      const c = source.condition ?? "NONE";
      conditionCounts[c] = (conditionCounts[c] ?? 0) + 1;
    }
    cursor = batch[batch.length - 1]!.id;
    if (batch.length < BATCH) break;
  }
  return {
    rows,
    modelVersions: [...models].sort(),
    promptVersions: [...prompts].sort(),
    conditionCounts,
  };
}

export interface CreateExportResult {
  exportId: string;
  status: "REQUESTED" | "COMPLETED";
  queued: boolean;
  rowCount: number | null;
  checksum: string | null;
}

/**
 * Create a research export (contract: docs/_CONTRACTS.md).
 * Authorization: research:export (RESEARCH_ADMIN). Field allowlist enforced before anything is written.
 * Small exports run inline; larger ones are enqueued on the `exports` queue (worker/jobs/export.ts).
 */
export async function createResearchExport(
  user: Principal,
  input: ExportRequest,
): Promise<CreateExportResult> {
  assertCan(user, "research:export");
  const req = exportRequestSchema.parse({ ...input });
  assertFieldsAllowed(req.fields);
  const filters = filtersOf(req);
  if (req.from && req.to && req.to <= req.from) {
    throw new HttpError(400, "invalid_range", "The end date must be after the start date");
  }
  if (req.courseId) {
    const course = await prisma.course.findUnique({
      where: { id: req.courseId },
      select: { id: true },
    });
    if (!course) throw new HttpError(404, "course_not_found", "Course not found");
  }

  const total = await countRows(filters);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.researchExport.create({
      data: {
        requestedById: user.id,
        courseId: req.courseId ?? null,
        filters: filters as Prisma.InputJsonValue,
        fields: req.fields,
        format: req.format,
        status: "REQUESTED",
        purpose: "research",
      },
    });
    await writeAudit(
      {
        actorId: user.id,
        action: "research.export_requested",
        targetType: "ResearchExport",
        targetId: created.id,
        courseId: req.courseId ?? null,
        metadata: {
          filters: filters as Prisma.InputJsonValue,
          fields: req.fields,
          format: req.format,
          estimatedRows: total,
        },
      },
      tx,
    );
    return created;
  });

  if (total > INLINE_ROW_LIMIT) {
    try {
      await getQueue(QUEUE_NAMES.exports).add(
        "research-export",
        { exportId: row.id },
        { jobId: `research-export-${row.id}` },
      );
    } catch {
      await prisma.researchExport.update({
        where: { id: row.id },
        data: {
          status: "FAILED",
          errorMessage: "Could not enqueue (queue unavailable)",
          completedAt: new Date(),
        },
      });
      throw new HttpError(
        503,
        "queue_unavailable",
        "The export queue is unavailable. Try again shortly.",
      );
    }
    return { exportId: row.id, status: "REQUESTED", queued: true, rowCount: null, checksum: null };
  }

  const done = await runResearchExport(row.id);
  return {
    exportId: row.id,
    status: "COMPLETED",
    queued: false,
    rowCount: done.rowCount,
    checksum: done.checksum,
  };
}

/** Executes a REQUESTED export (inline or from the worker). Idempotent: only one caller can claim it. */
export async function runResearchExport(
  exportId: string,
): Promise<{ rowCount: number; checksum: string }> {
  const claimed = await prisma.researchExport.updateMany({
    where: { id: exportId, status: "REQUESTED" },
    data: { status: "RUNNING" },
  });
  if (claimed.count === 0) {
    const existing = await prisma.researchExport.findUnique({ where: { id: exportId } });
    if (existing?.status === "COMPLETED" && existing.checksum) {
      return { rowCount: existing.rowCount ?? 0, checksum: existing.checksum };
    }
    throw new HttpError(409, "export_not_runnable", "Export is not waiting to run");
  }
  const exp = await prisma.researchExport.findUniqueOrThrow({ where: { id: exportId } });
  try {
    // Re-authorize the requester at run time (permissions may have changed while queued).
    const requester = await loadPrincipal(exp.requestedById);
    assertCan(requester, "research:export");
    assertFieldsAllowed(exp.fields);

    const filters = exp.filters as unknown as StoredFilters;
    const built = await buildRows(filters, exp.fields);
    const text = serialize(exp.format === "JSON" ? "JSON" : "CSV", exp.fields, built.rows);
    const ext = exp.format === "JSON" ? "json" : "csv";
    const stored = await getStorage().put(`research-exports/${exp.id}.${ext}`, text);
    const checksum = sha256Hex(text);

    await prisma.$transaction(async (tx) => {
      const agg = await tx.datasetManifest.aggregate({
        where: { datasetKey: "research-export" },
        _max: { version: true },
      });
      const manifest = await tx.datasetManifest.create({
        data: {
          datasetKey: "research-export",
          version: (agg._max.version ?? 0) + 1,
          name: `Research export ${exp.id}`,
          purpose: "RESEARCH",
          owner: `research-admin:${exp.requestedById}`,
          sourceSystems: ["AnalyticsEvent", "StudyParticipant"],
          sourceWindowStart: filters.from ? new Date(filters.from) : null,
          sourceWindowEnd: filters.to ? new Date(filters.to) : null,
          eligibleCohort: filters.courseId ?? "all courses",
          policyBasis:
            "Participants with consent not DECLINED/WITHDRAWN and not withdrawn; exported by a RESEARCH_ADMIN; audited.",
          rowGrain: "interaction",
          fieldsIncluded: exp.fields,
          fieldsExcluded: [
            ...EXPORT_FIELD_KEYS.filter((k) => !exp.fields.includes(k)),
            ...ALWAYS_EXCLUDED,
          ],
          inclusionRules: filters as Prisma.InputJsonValue,
          exclusionRules: {
            quarantinedEvents: true,
            researchFamilyEvents: true,
            withdrawnOrDeclinedParticipants: true,
          },
          deidentificationTransformations: {
            participantId: `${PSEUDONYM_METHOD} pseudonym of user id`,
            removed: ALWAYS_EXCLUDED,
          },
          deidentificationVersion: `pseudonym-key-v${PSEUDONYM_KEY_VERSION}`,
          codeVersion: `${EXPORT_CODE_VERSION}@app-${env().APP_VERSION}`,
          queryVersion: EXPORT_CODE_VERSION,
          modelVersions: built.modelVersions,
          promptVersions: built.promptVersions,
          recordCount: built.rows.length,
          checksum,
          createdById: exp.requestedById,
          frozenAt: new Date(),
          knownLimitations: `Condition balance in this export: ${JSON.stringify(built.conditionCounts)}`,
        },
      });
      await tx.researchExport.update({
        where: { id: exp.id },
        data: {
          status: "COMPLETED",
          manifestId: manifest.id,
          rowCount: built.rows.length,
          checksum,
          filePath: stored.key,
          completedAt: new Date(),
          errorMessage: null,
        },
      });
      await writeAudit(
        {
          actorId: exp.requestedById,
          action: "research.export",
          targetType: "ResearchExport",
          targetId: exp.id,
          courseId: exp.courseId,
          metadata: {
            manifestId: manifest.id,
            datasetVersion: manifest.version,
            rowCount: built.rows.length,
            checksum,
            format: exp.format,
            fields: exp.fields,
            filters: filters as Prisma.InputJsonValue,
          },
        },
        tx,
      );
      await writeEvent(tx, {
        eventName: "research_export_generated",
        actorId: exp.requestedById,
        courseId: exp.courseId,
        idempotencyKey: `research_export_generated:${exp.id}`,
        researchCondition: null,
        metadata: {
          exportId: exp.id,
          manifestId: manifest.id,
          rowCount: built.rows.length,
          checksum,
        },
      });
    });
    return { rowCount: built.rows.length, checksum };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : "Export failed";
    await prisma.researchExport.update({
      where: { id: exportId },
      data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
    });
    await writeAudit({
      actorId: exp.requestedById,
      action: "research.export_failed",
      targetType: "ResearchExport",
      targetId: exportId,
      courseId: exp.courseId,
      metadata: { error: message },
    }).catch(() => undefined);
    throw err;
  }
}

export async function listResearchExports(user: Principal) {
  assertCan(user, "research:read");
  const rows = await prisma.researchExport.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { manifest: { select: { version: true, datasetKey: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt,
    completedAt: r.completedAt,
    status: r.status,
    format: r.format,
    courseId: r.courseId,
    filters: r.filters as StoredFilters,
    fields: r.fields,
    rowCount: r.rowCount,
    checksum: r.checksum,
    datasetVersion: r.manifest?.version ?? null,
    errorMessage: r.errorMessage,
  }));
}

/** Authorized, audited download. Verifies the stored file against the recorded checksum before serving. */
export async function getResearchExportDownload(user: Principal, exportId: string) {
  assertCan(user, "research:export");
  const exp = await prisma.researchExport.findUnique({ where: { id: exportId } });
  if (!exp) throw new HttpError(404, "export_not_found", "Export not found");
  if (exp.status !== "COMPLETED" || !exp.filePath || !exp.checksum) {
    throw new HttpError(409, "export_not_ready", "Export is not ready");
  }
  const data = await getStorage().get(exp.filePath);
  if (sha256Hex(data) !== exp.checksum) {
    throw new HttpError(500, "checksum_mismatch", "Stored export does not match its checksum");
  }
  await writeAudit({
    actorId: user.id,
    action: "research.export_download",
    targetType: "ResearchExport",
    targetId: exp.id,
    courseId: exp.courseId,
    metadata: { checksum: exp.checksum, rowCount: exp.rowCount },
  });
  const ext = exp.format === "JSON" ? "json" : "csv";
  return {
    data,
    filename: `socra-research-export-${exp.id}.${ext}`,
    contentType: exp.format === "JSON" ? "application/json" : "text/csv; charset=utf-8",
  };
}
