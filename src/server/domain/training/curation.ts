import { createHash } from "node:crypto";

/**
 * Pure curation rules for the model-improvement plane (TASK §25, data-pipelines §1.10).
 * Nothing flows in automatically: a candidate is usable only when trainingEligible = true AND all nine gates passed
 * AND reviewStatus = APPROVED. Held-out evaluation items (by content hash) and eval splits are always excluded.
 */

export const TRAINING_GATES = [
  "gatePolicyAllowed",
  "gateDeidentified",
  "gatePiiSecretScanPassed",
  "gateHiddenTestLeakagePassed",
  "gateCopyrightAuthorized",
  "gateQualityReviewed",
  "gateDeduplicated",
  "gateContaminationCheckPassed",
  "gateDatasetVersioned",
] as const;

export type TrainingGate = (typeof TRAINING_GATES)[number];

export const EVAL_SPLITS = ["VALIDATION", "TEST"] as const;

export type CandidateLike = {
  id: string;
  contentHash: string;
  content?: unknown;
  trainingEligible: boolean;
  reviewStatus: string;
  datasetSplit: string;
} & Record<TrainingGate, boolean>;

export function failedGates(c: Record<TrainingGate, boolean>): TrainingGate[] {
  return TRAINING_GATES.filter((g) => c[g] !== true);
}

export function allGatesPassed(c: Record<TrainingGate, boolean>): boolean {
  return failedGates(c).length === 0;
}

/** The single eligibility predicate. Default-false: any missing flag or gate excludes the row. */
export function isCurated(c: CandidateLike): boolean {
  return c.trainingEligible === true && c.reviewStatus === "APPROVED" && allGatesPassed(c);
}

/** Stable JSON (sorted keys) for hashing. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}

export function contentHashOf(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export type ExclusionReason = "not_curated" | "held_out" | "eval_split" | "not_train_split";

export interface DatasetSelection<T extends CandidateLike> {
  included: T[];
  excluded: { id: string; reason: ExclusionReason }[];
}

/**
 * Select rows for a TRAINING dataset: curated, TRAIN split only, and never a held-out item. A candidate matches the
 * held-out set when its stored contentHash or the hash of its content equals a HeldOutEvalItem.contentHash.
 */
export function selectTrainingRows<T extends CandidateLike>(
  candidates: readonly T[],
  heldOutHashes: Iterable<string>,
): DatasetSelection<T> {
  const heldOut = new Set(heldOutHashes);
  const included: T[] = [];
  const excluded: { id: string; reason: ExclusionReason }[] = [];
  for (const c of candidates) {
    if (!isCurated(c)) {
      excluded.push({ id: c.id, reason: "not_curated" });
      continue;
    }
    const recomputed = c.content !== undefined ? contentHashOf(c.content) : null;
    if (heldOut.has(c.contentHash) || (recomputed && heldOut.has(recomputed))) {
      excluded.push({ id: c.id, reason: "held_out" });
      continue;
    }
    if ((EVAL_SPLITS as readonly string[]).includes(c.datasetSplit)) {
      excluded.push({ id: c.id, reason: "eval_split" });
      continue;
    }
    if (c.datasetSplit !== "TRAIN") {
      excluded.push({ id: c.id, reason: "not_train_split" });
      continue;
    }
    included.push(c);
  }
  return { included, excluded };
}

/** Order-independent checksum of the included content hashes. */
export function datasetChecksum(hashes: readonly string[]): string {
  return createHash("sha256")
    .update([...hashes].sort().join("\n"))
    .digest("hex");
}
