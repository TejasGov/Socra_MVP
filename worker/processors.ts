import type { Job } from "bullmq";
import type { QueueName } from "@/server/queues";

/**
 * BullMQ processors by queue. Domain agents add entries, e.g.:
 *   import { processCodeRunJob } from "@/server/runner/queue";
 *   [QUEUE_NAMES.codeRuns]: processCodeRunJob,
 * Queues without a processor fail their jobs with a clear error (recorded in BackgroundJobFailure).
 */
export type JobProcessor = (job: Job) => Promise<unknown>;

import { processEmbeddingsJob } from "./jobs/embeddings";
import { processExportJob } from "./jobs/export";
import { processCodeRunJob } from "./jobs/code-run";

export const processors: Partial<Record<QueueName, JobProcessor>> = {
  "code-runs": processCodeRunJob,
  embeddings: processEmbeddingsJob,
  exports: processExportJob,
};
