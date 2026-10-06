import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { writeAudit } from "@/server/audit";
import {
  TRAINING_GATES,
  datasetChecksum,
  failedGates,
  selectTrainingRows,
  type TrainingGate,
} from "./curation";

export * from "./curation";

/** Where clause matching only curated rows (eligible + nine gates + APPROVED). */
export const CURATED_WHERE: Prisma.TrainingCandidateWhereInput = {
  trainingEligible: true,
  reviewStatus: "APPROVED",
  ...Object.fromEntries(TRAINING_GATES.map((g) => [g, true])),
};

export async function listCuratedCandidates() {
  return prisma.trainingCandidate.findMany({ where: CURATED_WHERE, orderBy: { createdAt: "asc" } });
}

/** Record gate results for a candidate (reviewer action). Never sets trainingEligible. */
export async function recordGateResults(
  candidateId: string,
  gates: Partial<Record<TrainingGate, boolean>>,
  reviewerId: string,
) {
  return prisma.trainingCandidate.update({
    where: { id: candidateId },
    data: { ...gates, reviewedById: reviewerId, reviewedAt: new Date() },
  });
}

/** Explicitly mark a candidate training-eligible. Refuses unless all nine gates passed and review is APPROVED. */
export async function markTrainingEligible(
  candidateId: string,
  input: { reason: string; consentBasis: string; reviewerId: string },
) {
  const c = await prisma.trainingCandidate.findUniqueOrThrow({ where: { id: candidateId } });
  const failed = failedGates(c);
  if (failed.length > 0)
    throw new Error(`Cannot mark eligible; failed gates: ${failed.join(", ")}`);
  if (c.reviewStatus !== "APPROVED")
    throw new Error("Cannot mark eligible; review is not APPROVED");
  return prisma.trainingCandidate.update({
    where: { id: candidateId },
    data: {
      trainingEligible: true,
      trainingEligibilityReason: input.reason,
      consentBasis: input.consentBasis,
      reviewedById: input.reviewerId,
      reviewedAt: new Date(),
    },
  });
}

export interface BuildDatasetResult {
  datasetVersionId: string;
  manifestId: string;
  version: number;
  recordCount: number;
  excluded: Record<string, number>;
  checksum: string;
}

/**
 * Build a frozen TRAINING DatasetVersion + DatasetManifest from curated candidates only.
 * Excludes every HeldOutEvalItem (by content hash) and every VALIDATION/TEST row. Audited.
 */
export async function buildDatasetVersion(input: {
  name: string;
  createdById: string;
  knownLimitations?: string;
}): Promise<BuildDatasetResult> {
  const [candidates, heldOut] = await Promise.all([
    prisma.trainingCandidate.findMany({ where: CURATED_WHERE }),
    prisma.heldOutEvalItem.findMany({ select: { contentHash: true } }),
  ]);
  const selection = selectTrainingRows(
    candidates,
    heldOut.map((h) => h.contentHash),
  );
  const excluded: Record<string, number> = {};
  for (const e of selection.excluded) excluded[e.reason] = (excluded[e.reason] ?? 0) + 1;
  const checksum = datasetChecksum(selection.included.map((c) => c.contentHash));
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((v): v is string => !!v))];

  const result = await prisma.$transaction(async (tx) => {
    const last = await tx.datasetVersion.findFirst({
      where: { name: input.name },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;
    const now = new Date();
    const manifest = await tx.datasetManifest.create({
      data: {
        datasetKey: input.name,
        version,
        name: input.name,
        purpose: "TRAINING",
        owner: input.createdById,
        sourceSystems: ["TrainingCandidate"],
        policyBasis:
          "Curated candidates only: trainingEligible, nine gates passed, review APPROVED",
        rowGrain: "interaction",
        fieldsIncluded: [
          "sourceType",
          "content",
          "contentHash",
          "sourceModelVersion",
          "sourcePromptVersion",
        ],
        fieldsExcluded: ["courseId", "sourceId", "sourceTable", "reviewedById"],
        inclusionRules: {
          trainingEligible: true,
          reviewStatus: "APPROVED",
          gates: [...TRAINING_GATES],
          split: "TRAIN",
        },
        exclusionRules: {
          heldOutEvalByContentHash: true,
          evalSplits: ["VALIDATION", "TEST"],
          excludedCounts: excluded,
        },
        deidentificationVersion: "gateDeidentified",
        dedupMethod: "unique contentHash + gateDeduplicated",
        splitRule: "split assigned on the candidate before curation; only TRAIN rows exported",
        knownLimitations: input.knownLimitations ?? null,
        codeVersion: env().APP_VERSION,
        modelVersions: uniq(selection.included.map((c) => c.sourceModelVersion)),
        promptVersions: uniq(selection.included.map((c) => c.sourcePromptVersion)),
        recordCount: selection.included.length,
        checksum,
        retentionRule: "TRAINING retention class; remove source examples on policy request",
        createdById: input.createdById,
        frozenAt: now,
      },
    });
    const dv = await tx.datasetVersion.create({
      data: {
        name: input.name,
        version,
        purpose: "TRAINING",
        status: "FROZEN",
        manifestId: manifest.id,
        recordCount: selection.included.length,
        checksum,
        createdById: input.createdById,
        frozenAt: now,
      },
    });
    if (selection.included.length > 0) {
      await tx.trainingCandidate.updateMany({
        where: { id: { in: selection.included.map((c) => c.id) } },
        data: { datasetVersionId: dv.id },
      });
    }
    return { datasetVersionId: dv.id, manifestId: manifest.id, version };
  });

  await writeAudit({
    actorId: input.createdById,
    action: "training.dataset_export",
    targetType: "DatasetVersion",
    targetId: result.datasetVersionId,
    metadata: {
      name: input.name,
      version: result.version,
      recordCount: selection.included.length,
      excluded,
      checksum,
    },
  });
  return { ...result, recordCount: selection.included.length, excluded, checksum };
}
