import "server-only";
import { Queue, QueueEvents } from "bullmq";
import { bullConnection } from "./redis";

/**
 * BullMQ queue registry shared by the web app (producers) and the worker (consumers).
 * Each queue's job payload contract lives with the domain that owns it; keep payloads small (ids, not content).
 */

export const QUEUE_NAMES = {
  /** { runId } — CodeRun row holds the code; worker executes via CodeRunner. */
  codeRuns: "code-runs",
  /** { resourceId, version } or { practiceItemId } — chunk + embed. */
  embeddings: "embeddings",
  /** { courseId?, scope? } — recompute aggregate tables. */
  aggregation: "aggregation",
  /** { exportId } — research / dataset exports. */
  exports: "exports",
  /** { dryRun } — retention policy enforcement. */
  retention: "retention",
  /** { submissionId } — grading pipeline (hidden tests + AI suggestion). */
  grading: "grading",
  /** { userId, courseId, topicIds? } — learner topic-state recomputation. */
  learner: "learner",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const globalForQueues = globalThis as unknown as {
  __socraQueues?: Map<string, Queue>;
  __socraQueueEvents?: Map<string, QueueEvents>;
};

export function getQueue(name: QueueName): Queue {
  globalForQueues.__socraQueues ??= new Map();
  let q = globalForQueues.__socraQueues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: bullConnection(),
      // Code-run results (test names/outcomes) also appear in the queue's event stream: keep it short.
      ...(name === QUEUE_NAMES.codeRuns ? { streams: { events: { maxLen: 200 } } } : {}),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
    q.on("error", () => undefined);
    globalForQueues.__socraQueues.set(name, q);
  }
  return q;
}

/** QueueEvents (for `job.waitUntilFinished`) — one per queue per process. */
export function getQueueEvents(name: QueueName): QueueEvents {
  globalForQueues.__socraQueueEvents ??= new Map();
  let qe = globalForQueues.__socraQueueEvents.get(name);
  if (!qe) {
    qe = new QueueEvents(name, { connection: bullConnection() });
    qe.on("error", () => undefined);
    globalForQueues.__socraQueueEvents.set(name, qe);
  }
  return qe;
}

export async function closeQueues(): Promise<void> {
  await Promise.allSettled([
    ...[...(globalForQueues.__socraQueues?.values() ?? [])].map((q) => q.close()),
    ...[...(globalForQueues.__socraQueueEvents?.values() ?? [])].map((q) => q.close()),
  ]);
  globalForQueues.__socraQueues?.clear();
  globalForQueues.__socraQueueEvents?.clear();
}
