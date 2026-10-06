import type { StudyCondition } from "@/generated/prisma/enums";
import { envelopeToRow, validateEnvelope, type EventEnvelope } from "@/server/events/envelope";
import { pseudonymFor } from "@/server/events/pseudonym";
import { EVENTS, type EventName } from "@/server/events/taxonomy";
import { detUuid } from "./state";

const APP_VERSION = process.env.APP_VERSION ?? "0.1.0";

export interface SeedEventInput {
  name: EventName;
  /** Stable key: the same key always yields the same eventId / idempotencyKey. */
  key: string;
  at: Date;
  actorId?: string | null;
  courseId?: string | null;
  sectionId?: string | null;
  assignmentId?: string | null;
  assignmentVersion?: number | null;
  questionId?: string | null;
  questionVersion?: number | null;
  sessionId?: string | null;
  condition?: StudyCondition | null;
  metadata: Record<string, unknown>;
}

type EventRow = ReturnType<typeof envelopeToRow>;

/** Collects valid, deterministic AnalyticsEvent rows. Throws on any envelope that would be quarantined. */
export class EventSink {
  rows: EventRow[] = [];
  private pseudo = new Map<string, string>();
  readonly byName: Record<string, number> = {};

  idFor(key: string): string {
    return detUuid(key);
  }

  add(input: SeedEventInput): string {
    const def = EVENTS[input.name];
    const eventId = detUuid(input.key);
    let pseudonym: string | null = null;
    if (input.actorId) {
      pseudonym = this.pseudo.get(input.actorId) ?? pseudonymFor(input.actorId);
      this.pseudo.set(input.actorId, pseudonym);
    }
    const envelope: EventEnvelope = {
      eventId,
      eventName: input.name,
      schemaVersion: def.schemaVersion,
      actorId: input.actorId ?? null,
      pseudonymousId: pseudonym,
      courseId: input.courseId ?? null,
      sectionId: input.sectionId ?? null,
      assignmentId: input.assignmentId ?? null,
      assignmentVersion: input.assignmentVersion ?? null,
      questionId: input.questionId ?? null,
      questionVersion: input.questionVersion ?? null,
      sessionId: input.sessionId ?? null,
      occurredAt: input.at.toISOString(),
      receivedAt: new Date(input.at.getTime() + 1500).toISOString(),
      appVersion: APP_VERSION,
      researchCondition: input.condition ?? null,
      idempotencyKey: `seed:${input.key}`,
      metadata: input.metadata,
      sourceTraceId: null,
      privacyClass: def.privacyClass,
    };
    const verdict = validateEnvelope(envelope);
    if (verdict.status !== "ACCEPTED") {
      throw new Error(`seed event ${input.name} (${input.key}) invalid: ${verdict.reason}`);
    }
    this.rows.push(envelopeToRow({ envelope, status: "ACCEPTED", quarantineReason: null }));
    this.byName[input.name] = (this.byName[input.name] ?? 0) + 1;
    return eventId;
  }
}
