import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_ACTIONS,
  ASSIGNMENT_STATES,
  acceptsSubmissions,
  availableActions,
  canTransition,
  progressTransition,
  shouldAutoClose,
  shouldAutoOpen,
  studentMode,
  transition,
  type AssignmentAction,
  type AssignmentState,
} from "@/server/domain/assignments/state-machine";

const EXPECTED: Record<AssignmentAction, Partial<Record<AssignmentState, AssignmentState>>> = {
  publish: { DRAFT: "PUBLISHED_PROTECTED", SCHEDULED: "PUBLISHED_PROTECTED" },
  schedule: { DRAFT: "SCHEDULED" },
  close: { PUBLISHED_PROTECTED: "CLOSED" },
  reopen: { CLOSED: "PUBLISHED_PROTECTED" },
  archive: { DRAFT: "ARCHIVED", CLOSED: "ARCHIVED" },
  releaseSolutions: { CLOSED: "CLOSED", ARCHIVED: "ARCHIVED" },
};

describe("assignment state machine: transitions (exhaustive)", () => {
  for (const state of ASSIGNMENT_STATES) {
    for (const action of ASSIGNMENT_ACTIONS) {
      const target = EXPECTED[action][state];
      it(`${state} --${action}--> ${target ?? "rejected"}`, () => {
        const r = transition(state, action);
        if (target) {
          expect(r.ok).toBe(true);
          if (r.ok) expect(r.state).toBe(target);
          expect(canTransition(state, action)).toBe(true);
        } else {
          expect(r.ok).toBe(false);
          expect(canTransition(state, action)).toBe(false);
        }
      });
    }
  }

  it("lists available actions per state", () => {
    expect(availableActions("DRAFT").sort()).toEqual(["archive", "publish", "schedule"]);
    expect(availableActions("PUBLISHED_PROTECTED")).toEqual(["close"]);
    expect(availableActions("ARCHIVED")).toEqual(["releaseSolutions"]);
  });

  it("marks privileged actions as audited", () => {
    for (const a of ["close", "reopen", "archive"] as const) {
      const s = ASSIGNMENT_STATES.find((st) => canTransition(st, a))!;
      const r = transition(s, a);
      expect(r.ok && r.effects.audited).toBe(true);
    }
    const pub = transition("DRAFT", "publish");
    expect(pub.ok && pub.effects.audited).toBe(false);
  });

  it("release sets solutionsReleased and cannot repeat", () => {
    const first = transition("CLOSED", "releaseSolutions");
    expect(first.ok && first.effects.solutionsReleased).toBe(true);
    expect(transition("CLOSED", "releaseSolutions", { solutionsReleased: true }).ok).toBe(false);
  });

  it("reopen revokes an earlier release", () => {
    const r = transition("CLOSED", "reopen", { solutionsReleased: true });
    expect(r.ok && r.effects.solutionsReleased).toBe(false);
    const none = transition("CLOSED", "reopen", { solutionsReleased: false });
    expect(none.ok && none.effects.solutionsReleased).toBeUndefined();
  });
});

describe("studentMode", () => {
  it("is PROTECTED_ASSESSMENT while the assignment is open", () => {
    expect(studentMode({ state: "PUBLISHED_PROTECTED", solutionsReleased: false })).toBe(
      "PROTECTED_ASSESSMENT",
    );
  });

  it("submit early does not unlock review mode", () => {
    for (const status of ["SUBMITTED", "RETURNED", "IN_PROGRESS", "NOT_STARTED"] as const) {
      expect(
        studentMode({ state: "PUBLISHED_PROTECTED", solutionsReleased: false }, { status }),
      ).toBe("PROTECTED_ASSESSMENT");
    }
    // Even a (bad) released flag on an open assignment never produces review mode.
    expect(
      studentMode(
        { state: "PUBLISHED_PROTECTED", solutionsReleased: true },
        { status: "SUBMITTED" },
      ),
    ).toBe("PROTECTED_ASSESSMENT");
  });

  it("closed but not released stays protected", () => {
    expect(
      studentMode({ state: "CLOSED", solutionsReleased: false }, { status: "SUBMITTED" }),
    ).toBe("PROTECTED_ASSESSMENT");
  });

  it("closed and released is POST_ASSESSMENT_REVIEW regardless of progress", () => {
    for (const status of ["NOT_STARTED", "SUBMITTED", "CLOSED"] as const) {
      expect(studentMode({ state: "CLOSED", solutionsReleased: true }, { status })).toBe(
        "POST_ASSESSMENT_REVIEW",
      );
    }
  });

  it("scheduled and draft are never review mode", () => {
    expect(studentMode({ state: "DRAFT", solutionsReleased: true })).toBe("PROTECTED_ASSESSMENT");
    expect(studentMode({ state: "SCHEDULED", solutionsReleased: true })).toBe(
      "PROTECTED_ASSESSMENT",
    );
  });
});

describe("submission acceptance and scheduling", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  it("accepts only while open and inside the dates", () => {
    expect(acceptsSubmissions({ state: "PUBLISHED_PROTECTED" }, now)).toBe(true);
    expect(acceptsSubmissions({ state: "CLOSED" }, now)).toBe(false);
    expect(acceptsSubmissions({ state: "SCHEDULED" }, now)).toBe(false);
    expect(
      acceptsSubmissions(
        { state: "PUBLISHED_PROTECTED", closeAt: new Date("2026-10-10T11:59:59Z") },
        now,
      ),
    ).toBe(false);
    expect(
      acceptsSubmissions(
        { state: "PUBLISHED_PROTECTED", openAt: new Date("2026-10-11T00:00:00Z") },
        now,
      ),
    ).toBe(false);
  });

  it("auto open and close", () => {
    expect(
      shouldAutoOpen({ state: "SCHEDULED", openAt: new Date("2026-10-10T12:00:00Z") }, now),
    ).toBe(true);
    expect(
      shouldAutoOpen({ state: "SCHEDULED", openAt: new Date("2026-10-10T12:00:01Z") }, now),
    ).toBe(false);
    expect(
      shouldAutoClose(
        { state: "PUBLISHED_PROTECTED", closeAt: new Date("2026-10-10T11:00:00Z") },
        now,
      ),
    ).toBe(true);
    expect(
      shouldAutoClose({ state: "DRAFT", closeAt: new Date("2026-10-10T11:00:00Z") }, now),
    ).toBe(false);
    expect(shouldAutoClose({ state: "PUBLISHED_PROTECTED", closeAt: null }, now)).toBe(false);
  });
});

describe("per-student progress", () => {
  it("walks the happy path", () => {
    let s = progressTransition("NOT_STARTED", "start");
    expect(s).toBe("IN_PROGRESS");
    s = progressTransition(s, "submit");
    expect(s).toBe("SUBMITTED");
    s = progressTransition(s, "return");
    expect(s).toBe("RETURNED");
  });

  it("editing after submit goes back to IN_PROGRESS only when resubmission is allowed", () => {
    expect(progressTransition("SUBMITTED", "save", { allowResubmission: true })).toBe(
      "IN_PROGRESS",
    );
    expect(progressTransition("SUBMITTED", "save", { allowResubmission: false })).toBe("SUBMITTED");
  });

  it("close marks everyone CLOSED except returned; reopen restores", () => {
    expect(progressTransition("NOT_STARTED", "assignmentClosed")).toBe("CLOSED");
    expect(progressTransition("SUBMITTED", "assignmentClosed")).toBe("CLOSED");
    expect(progressTransition("RETURNED", "assignmentClosed")).toBe("RETURNED");
    expect(progressTransition("CLOSED", "assignmentReopened", { hasSubmission: true })).toBe(
      "SUBMITTED",
    );
    expect(progressTransition("CLOSED", "assignmentReopened", { hasSubmission: false })).toBe(
      "IN_PROGRESS",
    );
  });

  it("a closed student cannot submit", () => {
    expect(progressTransition("CLOSED", "submit")).toBe("CLOSED");
  });
});
