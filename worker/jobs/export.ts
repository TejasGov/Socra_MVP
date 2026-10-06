import type { Job } from "bullmq";
import { runResearchExport } from "@/server/domain/research/export";

/** Queue `exports`: { exportId } — builds a large research export (the same code path as inline exports). */
export async function processExportJob(
  job: Job<{ exportId: string }>,
): Promise<{ rowCount: number; checksum: string }> {
  const exportId = job.data?.exportId;
  if (!exportId) throw new Error("exports job is missing exportId");
  return runResearchExport(exportId);
}
