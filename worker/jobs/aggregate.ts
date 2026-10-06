import type { Job } from "bullmq";
import { recomputeAggregates } from "@/server/domain/analytics/aggregate";
import { recomputeAllTopicStates, recomputeTopicStates } from "@/server/domain/learner/recompute";
import { getQueue, QUEUE_NAMES } from "@/server/queues";
import { processors } from "../processors";

/**
 * Aggregation job (queue "aggregation"): `{ courseId? }` recomputes the *Aggregate tables (all active courses when
 * courseId is absent). A repeatable job runs every 5 minutes; enqueue `{ courseId }` for an on-demand refresh.
 *
 * Learner job (queue "learner"): `{ userId, courseId, topicIds? }` rebuilds LearnerTopicState from evidence;
 * `{ all: true }` rebuilds every pair (estimator upgrades, evidence corrections).
 */

export const AGGREGATE_EVERY_MS = 5 * 60 * 1000;

export interface AggregateJobData {
  courseId?: string;
}

export async function processAggregateJob(job: Job<AggregateJobData>) {
  const result = await recomputeAggregates(job.data?.courseId);
  console.info(
    `[aggregate] ${result.courses} course(s), ${result.rows} rows in ${result.durationMs}ms`,
  );
  return result;
}

export async function processLearnerJob(
  job: Job<{ userId?: string; courseId?: string; topicIds?: string[]; all?: boolean }>,
) {
  if (job.data.all) return recomputeAllTopicStates();
  if (!job.data.userId || !job.data.courseId)
    throw new Error("learner job needs userId + courseId");
  return recomputeTopicStates(job.data.userId, job.data.courseId, { topicIds: job.data.topicIds });
}

/** Enqueue an on-demand aggregation (web app or admin). */
export async function enqueueAggregation(courseId?: string): Promise<void> {
  await getQueue(QUEUE_NAMES.aggregation).add(
    "recompute",
    { courseId },
    { removeOnComplete: true },
  );
}

processors[QUEUE_NAMES.aggregation] = processAggregateJob as (job: Job) => Promise<unknown>;
processors[QUEUE_NAMES.learner] = processLearnerJob as (job: Job) => Promise<unknown>;

// Repeatable schedule (idempotent upsert). Scheduled after startup so a missing Redis never blocks the import.
setTimeout(() => {
  getQueue(QUEUE_NAMES.aggregation)
    .upsertJobScheduler(
      "aggregate-every-5-min",
      { every: AGGREGATE_EVERY_MS },
      { name: "recompute", data: {} },
    )
    .catch((err: unknown) =>
      console.error("[aggregate] could not schedule repeatable job:", (err as Error).message),
    );
}, 1000).unref();
