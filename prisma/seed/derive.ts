import { recomputeAggregates } from "@/server/domain/analytics";
import { recomputeAllTopicStates } from "@/server/domain/learner";
import type { SeedContext } from "./context";
import type { Acc, Student } from "./sim";

/**
 * Derived data: LearnerTopicState is rebuilt from the LearningEvidence rows by agent D's estimator, then the
 * course/assignment/question/topic/misconception aggregates are recomputed. emitEvents=false keeps the outbox empty
 * so the worker does not replay history.
 */
export async function finishDerivedData(
  ctx: SeedContext,
  _acc: Acc,
  _students: Student[],
): Promise<void> {
  const states = await recomputeAllTopicStates({ emitEvents: false });
  ctx.log(
    `topic states: ${states.topicsComputed} computed for ${states.pairs} student-course pairs`,
  );
  const agg = await recomputeAggregates();
  ctx.log(`aggregates: ${agg.rows} rows across ${agg.courses} courses (${agg.durationMs}ms)`);
}
