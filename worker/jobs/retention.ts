import type { Job } from "bullmq";
import { applyRetentionPolicies } from "@/server/domain/retention";
import { getQueue, QUEUE_NAMES } from "@/server/queues";
import { processors } from "../processors";

/**
 * Retention job (queue "retention"): `{ dryRun? }`. Dry-run unless RETENTION_ENFORCE=true AND dryRun === false.
 * Scheduled daily; logs per-category counts and writes a retention.run audit entry.
 */
export async function processRetentionJob(job: Job<{ dryRun?: boolean }>) {
  const report = await applyRetentionPolicies({ dryRun: job.data?.dryRun });
  for (const c of report.categories) {
    console.info(
      `[retention] ${c.category}: ${c.action} ${c.eligible} row(s) older than ${c.retentionDays ?? "-"}d${report.dryRun ? " (dry run)" : ""}`,
    );
  }
  return report;
}

processors[QUEUE_NAMES.retention] = processRetentionJob as (job: Job) => Promise<unknown>;

setTimeout(() => {
  getQueue(QUEUE_NAMES.retention)
    .upsertJobScheduler("retention-daily", { pattern: "30 3 * * *" }, { name: "apply", data: {} })
    .catch((err: unknown) =>
      console.error("[retention] could not schedule job:", (err as Error).message),
    );
}, 1500).unref();
