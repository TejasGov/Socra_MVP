import type { AiMode } from "../types";
import { facultyAnalytics } from "./faculty-analytics";
import { facultyAuthoring } from "./faculty-authoring";
import { postAssessmentReview } from "./post-assessment-review";
import { practice } from "./practice";
import { protectedAssessment } from "./protected-assessment";
import type { ModeDefinition } from "./shared";

export type { ModeDefinition, ContextRules, OutputHandling } from "./shared";
export { applyContextRules, assembleMessages } from "./shared";

export const MODE_DEFINITIONS: Record<AiMode, ModeDefinition> = {
  PROTECTED_ASSESSMENT: protectedAssessment,
  PRACTICE: practice,
  POST_ASSESSMENT_REVIEW: postAssessmentReview,
  FACULTY_AUTHORING: facultyAuthoring,
  FACULTY_ANALYTICS: facultyAnalytics,
};

export function getModeDefinition(mode: AiMode): ModeDefinition {
  return MODE_DEFINITIONS[mode];
}
