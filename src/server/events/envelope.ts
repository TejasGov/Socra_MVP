import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { EventStatus, PrivacyClass, StudyCondition } from "@/generated/prisma/enums";
import type { DbOrTx } from "../db";
import { env } from "../env";
import { pseudonymFor } from "./pseudonym";
import { EVENTS, findForbiddenKeys, type EventMetadata, type EventName } from "./taxonomy";

/**
 * Canonical event envelope (TASK §20 + data-pipelines §1.4):
 *   eventId, eventName, actorId, pseudonymousId, courseId, sectionId, assignmentId, assignmentVersion,
 *   questionId, questionVersion, sessionId, occurredAt, receivedAt, schemaVersion, appVersion,
 *   researchCondition, idempotencyKey, metadata, sourceTraceId, privacyClass
 */

export interface EventInput<N extends EventName = EventName> {
  eventName: N;
  actorId?: string | null;
  courseId?: string | null;
  sectionId?: string | null;
  assignmentId?: string | null;
  assignmentVersion?: number | null;
  questionId?: string | null;
  questionVersion?: number | null;
  sessionId?: string | null;
  /** When the action happened (defaults to now). */
  occurredAt?: Date;
  /**
   * Deterministic key for de-duplication, e.g. `submission_completed:${submissionId}`.
   * Strongly recommended; defaults to `${eventName}:${eventId}` (no cross-request de-dup).
   */
  idempotencyKey?: string;
  metadata: EventMetadata<N>;
  sourceTraceId?: string | null;
  /**
   * Explicit condition. `undefined` => looked up from StudyParticipant(actorId, courseId).
   * `null` => explicitly none.
   */
  researchCondition?: StudyCondition | null;
  /** Override the taxonomy privacy class (rare). */
  privacyClass?: PrivacyClass;
}

export interface EventEnvelope {
  eventId: string;
  eventName: EventName;
  schemaVersion: number;
  actorId: string | null;
  pseudonymousId: string | null;
  courseId: string | null;
  sectionId: string | null;
  assignmentId: string | null;
  assignmentVersion: number | null;
  questionId: string | null;
  questionVersion: number | null;
  sessionId: string | null;
  occurredAt: string;
  receivedAt: string;
  appVersion: string;
  researchCondition: StudyCondition | null;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  sourceTraceId: string | null;
  privacyClass: PrivacyClass;
}

export interface ValidatedEnvelope {
  envelope: EventEnvelope;
  status: EventStatus;
  quarantineReason: string | null;
}

/** Look up the actor's active study condition for a course (null when not a participant). */
export async function lookupResearchCondition(
  db: DbOrTx,
  actorId: string | null | undefined,
  courseId: string | null | undefined,
): Promise<StudyCondition | null> {
  if (!actorId || !courseId) return null;
  const participant = await db.studyParticipant.findUnique({
    where: { userId_courseId: { userId: actorId, courseId } },
    select: { condition: true, withdrawnAt: true },
  });
  if (!participant || participant.withdrawnAt) return null;
  return participant.condition;
}

/** Pure validation: metadata schema, forbidden keys, assignmentVersion requirement. */
export function validateEnvelope(envelope: EventEnvelope): {
  status: EventStatus;
  reason: string | null;
} {
  const def = EVENTS[envelope.eventName];
  if (!def) return { status: "QUARANTINED", reason: `unknown event ${envelope.eventName}` };
  if (
    def.requiresAssignmentVersion &&
    envelope.assignmentId &&
    envelope.assignmentVersion == null
  ) {
    return {
      status: "QUARANTINED",
      reason: "missing assignmentVersion for assignment-scoped event",
    };
  }
  const forbidden = findForbiddenKeys(envelope.eventName, envelope.metadata);
  if (forbidden.length > 0) {
    return { status: "QUARANTINED", reason: `forbidden metadata keys: ${forbidden.join(", ")}` };
  }
  const parsed = def.metadata.safeParse(envelope.metadata);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { status: "QUARANTINED", reason: `metadata invalid: ${issues}` };
  }
  return { status: "ACCEPTED", reason: null };
}

/** Build + validate an envelope. Looks up the research condition when not supplied. */
export async function buildEnvelope<N extends EventName>(
  db: DbOrTx,
  input: EventInput<N>,
): Promise<ValidatedEnvelope> {
  const def = EVENTS[input.eventName];
  const eventId = randomUUID();
  const now = new Date();
  const researchCondition =
    input.researchCondition === undefined
      ? await lookupResearchCondition(db, input.actorId, input.courseId)
      : input.researchCondition;
  const envelope: EventEnvelope = {
    eventId,
    eventName: input.eventName,
    schemaVersion: def.schemaVersion,
    actorId: input.actorId ?? null,
    pseudonymousId: input.actorId ? pseudonymFor(input.actorId) : null,
    courseId: input.courseId ?? null,
    sectionId: input.sectionId ?? null,
    assignmentId: input.assignmentId ?? null,
    assignmentVersion: input.assignmentVersion ?? null,
    questionId: input.questionId ?? null,
    questionVersion: input.questionVersion ?? null,
    sessionId: input.sessionId ?? null,
    occurredAt: (input.occurredAt ?? now).toISOString(),
    receivedAt: now.toISOString(),
    appVersion: env().APP_VERSION,
    researchCondition,
    idempotencyKey: input.idempotencyKey ?? `${input.eventName}:${eventId}`,
    metadata: (input.metadata ?? {}) as Record<string, unknown>,
    sourceTraceId: input.sourceTraceId ?? null,
    privacyClass: input.privacyClass ?? def.privacyClass,
  };
  const { status, reason } = validateEnvelope(envelope);
  return { envelope, status, quarantineReason: reason };
}

/** Map an envelope to AnalyticsEvent create data. */
export function envelopeToRow(v: ValidatedEnvelope): Prisma.AnalyticsEventCreateManyInput {
  const e = v.envelope;
  return {
    id: e.eventId,
    eventName: e.eventName,
    schemaVersion: e.schemaVersion,
    actorId: e.actorId,
    pseudonymousId: e.pseudonymousId,
    courseId: e.courseId,
    sectionId: e.sectionId,
    assignmentId: e.assignmentId,
    assignmentVersion: e.assignmentVersion,
    questionId: e.questionId,
    questionVersion: e.questionVersion,
    sessionId: e.sessionId,
    occurredAt: new Date(e.occurredAt),
    receivedAt: new Date(e.receivedAt),
    appVersion: e.appVersion,
    researchCondition: e.researchCondition,
    idempotencyKey: e.idempotencyKey,
    metadata: e.metadata as Prisma.InputJsonValue,
    sourceTraceId: e.sourceTraceId,
    privacyClass: e.privacyClass,
    status: v.status,
    quarantineReason: v.quarantineReason,
  };
}
