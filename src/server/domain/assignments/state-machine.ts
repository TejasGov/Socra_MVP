/**
 * Assignment lifecycle (TASK §9, PRD §10.3). Pure: no DB, no clock reads unless passed in.
 *
 * Assignment-level states: DRAFT, SCHEDULED, PUBLISHED_PROTECTED, CLOSED, ARCHIVED.
 * Per-student progress (NOT_STARTED, IN_PROGRESS, SUBMITTED, RETURNED, CLOSED) is separate, because a single
 * student submitting must never change what the rest of the class sees.
 *
 * The rule that matters: submitting does NOT unlock solutions. A student is in POST_ASSESSMENT_REVIEW only when the
 * assignment is CLOSED and the instructor's release setting has released solutions.
 */

export type AssignmentState = "DRAFT" | "SCHEDULED" | "PUBLISHED_PROTECTED" | "CLOSED" | "ARCHIVED";
export const ASSIGNMENT_STATES: readonly AssignmentState[] = [
  "DRAFT",
  "SCHEDULED",
  "PUBLISHED_PROTECTED",
  "CLOSED",
  "ARCHIVED",
];

export type AssignmentAction =
  "publish" | "schedule" | "close" | "reopen" | "archive" | "releaseSolutions";
export const ASSIGNMENT_ACTIONS: readonly AssignmentAction[] = [
  "publish",
  "schedule",
  "close",
  "reopen",
  "archive",
  "releaseSolutions",
];

export type ProgressStatus = "NOT_STARTED" | "IN_PROGRESS" | "SUBMITTED" | "RETURNED" | "CLOSED";
export type StudentMode = "PROTECTED_ASSESSMENT" | "POST_ASSESSMENT_REVIEW";

export interface TransitionEffects {
  /** New value for Assignment.solutionsReleased when the transition changes it. */
  solutionsReleased?: boolean;
  /** True when the action is privileged and must be audited (close/reopen/archive/release). */
  audited: boolean;
}

export type TransitionResult =
  { ok: true; state: AssignmentState; effects: TransitionEffects } | { ok: false; reason: string };

const TABLE: Record<AssignmentAction, Partial<Record<AssignmentState, AssignmentState>>> = {
  publish: { DRAFT: "PUBLISHED_PROTECTED", SCHEDULED: "PUBLISHED_PROTECTED" },
  schedule: { DRAFT: "SCHEDULED" },
  close: { PUBLISHED_PROTECTED: "CLOSED" },
  reopen: { CLOSED: "PUBLISHED_PROTECTED" },
  archive: { DRAFT: "ARCHIVED", CLOSED: "ARCHIVED" },
  releaseSolutions: { CLOSED: "CLOSED", ARCHIVED: "ARCHIVED" },
};

export function canTransition(state: AssignmentState, action: AssignmentAction): boolean {
  return TABLE[action][state] !== undefined;
}

export function availableActions(state: AssignmentState): AssignmentAction[] {
  return ASSIGNMENT_ACTIONS.filter((a) => canTransition(state, a));
}

/**
 * Pure transition. `solutionsReleased` is passed so a reopen revokes an earlier release (an open assignment must
 * never be in review mode) and so a repeated release is rejected.
 */
export function transition(
  state: AssignmentState,
  action: AssignmentAction,
  opts: { solutionsReleased?: boolean } = {},
): TransitionResult {
  const next = TABLE[action][state];
  if (!next) return { ok: false, reason: `Cannot ${action} an assignment that is ${state}` };
  const effects: TransitionEffects = { audited: action !== "publish" && action !== "schedule" };
  if (action === "releaseSolutions") {
    if (opts.solutionsReleased) return { ok: false, reason: "Solutions are already released" };
    effects.solutionsReleased = true;
  }
  if (action === "reopen" && opts.solutionsReleased) effects.solutionsReleased = false;
  return { ok: true, state: next, effects };
}

/** ON_CLOSE releases when the assignment closes; MANUAL waits for the instructor; NEVER never releases. */
export function releasesOnClose(mode: "NEVER" | "ON_CLOSE" | "MANUAL"): boolean {
  return mode === "ON_CLOSE";
}

/**
 * What a student sees. Deliberately ignores per-student progress: submitting early (SUBMITTED) does not unlock
 * anything. Review mode needs BOTH the assignment closed (or archived after closing) AND solutions released.
 */
export function studentMode(
  assignment: { state: AssignmentState; solutionsReleased: boolean },
  _progress?: { status: ProgressStatus } | null,
): StudentMode {
  const closed = assignment.state === "CLOSED" || assignment.state === "ARCHIVED";
  return closed && assignment.solutionsReleased ? "POST_ASSESSMENT_REVIEW" : "PROTECTED_ASSESSMENT";
}

/** Whether new submissions are accepted by assignment state and dates alone (attempt limits are checked elsewhere). */
export function acceptsSubmissions(
  assignment: { state: AssignmentState; openAt?: Date | null; closeAt?: Date | null },
  now: Date = new Date(),
): boolean {
  if (assignment.state !== "PUBLISHED_PROTECTED") return false;
  if (assignment.openAt && assignment.openAt.getTime() > now.getTime()) return false;
  if (assignment.closeAt && assignment.closeAt.getTime() <= now.getTime()) return false;
  return true;
}

/** Whether students can see the assignment at all. */
export function visibleToStudents(state: AssignmentState): boolean {
  return state === "PUBLISHED_PROTECTED" || state === "CLOSED";
}

/** Scheduled assignments whose open time has passed become PUBLISHED_PROTECTED. */
export function shouldAutoOpen(
  a: { state: AssignmentState; openAt?: Date | null },
  now: Date = new Date(),
): boolean {
  return a.state === "SCHEDULED" && !!a.openAt && a.openAt.getTime() <= now.getTime();
}

/** Open assignments whose close time has passed become CLOSED. */
export function shouldAutoClose(
  a: { state: AssignmentState; closeAt?: Date | null },
  now: Date = new Date(),
): boolean {
  return a.state === "PUBLISHED_PROTECTED" && !!a.closeAt && a.closeAt.getTime() <= now.getTime();
}

// --- Per-student progress -------------------------------------------------------------------------------------

export type ProgressEvent =
  "start" | "save" | "submit" | "return" | "assignmentClosed" | "assignmentReopened";

/**
 * Per-student progress. Submitting moves to SUBMITTED; a later edit on a resubmittable assignment moves back to
 * IN_PROGRESS. Closing marks every student CLOSED unless they were RETURNED. Reopening restores SUBMITTED or
 * IN_PROGRESS from the facts on the progress row.
 */
export function progressTransition(
  status: ProgressStatus,
  event: ProgressEvent,
  opts: { hasSubmission?: boolean; allowResubmission?: boolean } = {},
): ProgressStatus {
  switch (event) {
    case "start":
      return status === "NOT_STARTED" ? "IN_PROGRESS" : status;
    case "save":
      if (status === "NOT_STARTED") return "IN_PROGRESS";
      if (status === "SUBMITTED" && opts.allowResubmission) return "IN_PROGRESS";
      return status;
    case "submit":
      return status === "CLOSED" ? status : "SUBMITTED";
    case "return":
      return status === "SUBMITTED" || status === "CLOSED" ? "RETURNED" : status;
    case "assignmentClosed":
      return status === "RETURNED" ? status : "CLOSED";
    case "assignmentReopened":
      if (status !== "CLOSED") return status;
      return opts.hasSubmission ? "SUBMITTED" : "IN_PROGRESS";
  }
}

/** Student-facing label for a progress status. */
export const PROGRESS_LABELS: Record<ProgressStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Submitted",
  RETURNED: "Feedback available",
  CLOSED: "Closed",
};
