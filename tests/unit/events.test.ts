import { describe, expect, it } from "vitest";
import { validateEnvelope, type EventEnvelope } from "@/server/events/envelope";
import { pseudonymFor } from "@/server/events/pseudonym";
import { EVENT_NAMES, findForbiddenKeys } from "@/server/events/taxonomy";
import { backoffMs } from "@/server/events/dispatcher";

function envelope(partial: Partial<EventEnvelope>): EventEnvelope {
  return {
    eventId: "00000000-0000-0000-0000-000000000000",
    eventName: "course_opened",
    schemaVersion: 1,
    actorId: "u1",
    pseudonymousId: "p_x",
    courseId: "c1",
    sectionId: null,
    assignmentId: null,
    assignmentVersion: null,
    questionId: null,
    questionVersion: null,
    sessionId: null,
    occurredAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    appVersion: "test",
    researchCondition: null,
    idempotencyKey: "k",
    metadata: {},
    sourceTraceId: null,
    privacyClass: "EDUCATIONAL_RECORD",
    ...partial,
  };
}

describe("event taxonomy", () => {
  it("contains every event required by the task spec", () => {
    const required = [
      "course_opened",
      "assignment_opened",
      "question_viewed",
      "draft_saved",
      "code_run_requested",
      "code_run_completed",
      "socra_session_started",
      "socra_prompt_sent",
      "socra_response_completed",
      "socra_response_failed",
      "intervention_level_assigned",
      "course_resource_retrieved",
      "socra_limit_reached",
      "submission_started",
      "submission_completed",
      "deterministic_grade_completed",
      "ai_feedback_generated",
      "faculty_grade_finalized",
      "practice_started",
      "practice_item_shown",
      "practice_answered",
      "explanation_requested",
      "practice_completed",
      "misconception_observed",
      "learning_evidence_recorded",
      "learner_topic_state_changed",
      "analytics_viewed",
      "assignment_created",
      "assignment_ai_generated",
      "assignment_published",
    ];
    for (const name of required) expect(EVENT_NAMES).toContain(name);
  });
});

describe("envelope validation", () => {
  it("accepts a valid event", () => {
    expect(validateEnvelope(envelope({})).status).toBe("ACCEPTED");
  });

  it("quarantines assignment-scoped events missing assignmentVersion", () => {
    const v = validateEnvelope(
      envelope({ eventName: "assignment_opened", assignmentId: "a1", assignmentVersion: null }),
    );
    expect(v.status).toBe("QUARANTINED");
    expect(v.reason).toMatch(/assignmentVersion/);
  });

  it("quarantines invalid metadata", () => {
    const v = validateEnvelope(
      envelope({
        eventName: "draft_saved",
        assignmentId: "a1",
        assignmentVersion: 1,
        metadata: { draftVersion: "x" },
      }),
    );
    expect(v.status).toBe("QUARANTINED");
  });

  it("quarantines raw content / secrets in metadata", () => {
    const v = validateEnvelope(
      envelope({
        eventName: "draft_saved",
        assignmentId: "a1",
        assignmentVersion: 1,
        metadata: { draftVersion: 1, contentHash: "h", byteCount: 3, content: "print(1)" },
      }),
    );
    expect(v.status).toBe("QUARANTINED");
    expect(findForbiddenKeys("analytics_viewed", { scope: { nested: { apiKey: "x" } } })).toEqual([
      "scope.nested.apiKey",
    ]);
  });
});

describe("pseudonyms and backoff", () => {
  it("pseudonyms are deterministic per secret and do not contain the user id", () => {
    const a = pseudonymFor("user_1", "secret-a");
    expect(a).toBe(pseudonymFor("user_1", "secret-a"));
    expect(a).not.toBe(pseudonymFor("user_1", "secret-b"));
    expect(a).not.toContain("user_1");
    expect(a).toMatch(/^p_[0-9a-f]{24}$/);
  });

  it("backoff grows exponentially and is capped", () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(30)).toBe(10 * 60 * 1000);
  });
});
