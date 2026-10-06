import type { AssignmentInput } from "./schema";
import { parseAnswerKey, parseStoredChoices } from "@/lib/quiz";

/**
 * Pure publish-readiness checks (no DB). Returned as a list so the publish review can show every problem at once.
 * Warnings do not block publishing; errors do.
 */

export interface PublishIssue {
  severity: "error" | "warning";
  /** Dotted path into the authoring form, e.g. "questions.0.tests". */
  path: string;
  message: string;
}

export function validateForPublish(input: AssignmentInput): PublishIssue[] {
  const issues: PublishIssue[] = [];
  const err = (path: string, message: string) => issues.push({ severity: "error", path, message });
  const warn = (path: string, message: string) =>
    issues.push({ severity: "warning", path, message });

  if (!input.title.trim()) err("title", "Add a title.");
  if (input.questions.length === 0) err("questions", "Add at least one question.");
  if (input.format === "CODING" && !input.language) {
    const allHaveLanguage = input.questions.every((q) => q.language);
    if (!allHaveLanguage) err("language", "Choose a programming language.");
  }
  if (input.openAt && input.closeAt && input.closeAt <= input.openAt) {
    err("closeAt", "The close date must be after the open date.");
  }
  if (input.dueAt && input.closeAt && input.closeAt < input.dueAt) {
    err("closeAt", "The close date cannot be before the due date.");
  }
  if (input.openAt && input.dueAt && input.dueAt <= input.openAt) {
    err("dueAt", "The due date must be after the open date.");
  }
  if (!input.dueAt) warn("dueAt", "No due date set. Submissions will never be marked late.");
  if (!input.closeAt)
    warn("closeAt", "No close date set. You will need to close the assignment manually.");
  if (input.resourceScope === "SELECTED_RESOURCES" && input.resourceIds.length === 0) {
    err("resourceIds", "Select at least one resource, or change the resource scope.");
  }
  if (input.policy.maxInterventionLevel < 0 || input.policy.maxInterventionLevel > 6) {
    err("policy.maxInterventionLevel", "Maximum hint level must be between L0 and L6.");
  }

  input.questions.forEach((q, i) => {
    const at = `questions.${i}`;
    if (q.points <= 0) err(`${at}.points`, `Question ${i + 1}: set points above zero.`);
    const rubricTotal = q.rubric.reduce((s, c) => s + c.maxPoints, 0);
    if (rubricTotal > q.points + 1e-9) {
      err(
        `${at}.rubric`,
        `Question ${i + 1}: rubric criteria total ${rubricTotal}, more than the question's ${q.points} points.`,
      );
    }
    if (q.type === "CODING") {
      if (!(q.language ?? input.language))
        err(`${at}.language`, `Question ${i + 1}: choose a language.`);
      const graded = q.tests.filter((t) => t.visibility !== "DIAGNOSTIC");
      if (graded.length === 0) {
        err(`${at}.tests`, `Question ${i + 1}: add at least one public or hidden test.`);
      } else if (graded.reduce((s, t) => s + t.weight, 0) <= 0) {
        err(`${at}.tests`, `Question ${i + 1}: test weights must add up to more than zero.`);
      }
      if (rubricTotal >= q.points && graded.length > 0 && q.points > 0) {
        warn(
          `${at}.rubric`,
          `Question ${i + 1}: rubric uses every point, so tests will not count toward the score.`,
        );
      }
      if (!q.tests.some((t) => t.visibility === "PUBLIC")) {
        warn(
          `${at}.tests`,
          `Question ${i + 1}: no public tests. Students will have nothing to check against before submitting.`,
        );
      }
      for (const [j, t] of q.tests.entries()) {
        if (t.kind === "function" && !(t.entryPoint ?? q.entryPoint)) {
          err(
            `${at}.tests.${j}`,
            `Question ${i + 1}, test "${t.name}": set the function name to call.`,
          );
        }
      }
    } else if (q.type === "MULTIPLE_CHOICE") {
      const choices = parseStoredChoices(q.choices);
      if (choices.length < 2) err(`${at}.choices`, `Question ${i + 1}: add at least two choices.`);
      if (choices.some((c) => c.text.trim() === ""))
        err(`${at}.choices`, `Question ${i + 1}: every choice needs text.`);
      const correct = parseAnswerKey(q.answerKey).correct;
      if (choices.length >= 2 && !choices.some((c) => c.id === correct))
        err(`${at}.answerKey`, `Question ${i + 1}: mark the correct choice.`);
    } else if (q.type === "SHORT_ANSWER" && parseAnswerKey(q.answerKey).accepted.length > 0) {
      // Graded automatically against the accepted answers.
    } else if (q.rubric.length === 0) {
      warn(
        `${at}.rubric`,
        `Question ${i + 1}: no rubric. You will score this answer without criteria.`,
      );
    }
  });

  const total = input.questions.reduce((s, q) => s + q.points, 0);
  if (input.questions.length > 0 && total <= 0)
    err("questions", "Total points must be above zero.");
  if (input.learningObjectives.length === 0) warn("learningObjectives", "No learning objectives.");
  if (input.topicKeys.length === 0 && input.questions.every((q) => q.topicKeys.length === 0)) {
    warn(
      "topicKeys",
      "No topic tags. Analytics and the learning profile cannot use this assignment.",
    );
  }
  return issues;
}

export const hasBlockingIssues = (issues: PublishIssue[]): boolean =>
  issues.some((i) => i.severity === "error");
