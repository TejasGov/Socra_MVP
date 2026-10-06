import "server-only";

/**
 * Faculty analytics public API (contract: docs/_CONTRACTS.md, Agent D).
 * Every metric is { numerator, denominator, value, suppressed }. Aggregates only; never selects AiMessage.content.
 */

export { recomputeAggregates } from "./aggregate";
export {
  getCourseOverview,
  getAssignmentAnalytics,
  getQuestionDrilldown,
  getTopicDrilldown,
  getMisconceptionPatterns,
  listStaffCourses,
} from "./queries";
export * from "./types";
