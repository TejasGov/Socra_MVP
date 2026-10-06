import { describe, expect, it } from "vitest";
import {
  TRAINING_GATES,
  contentHashOf,
  isCurated,
  selectTrainingRows,
  type CandidateLike,
} from "@/server/domain/training/curation";

const allGates = Object.fromEntries(TRAINING_GATES.map((g) => [g, true])) as Record<
  (typeof TRAINING_GATES)[number],
  boolean
>;
const noGates = Object.fromEntries(TRAINING_GATES.map((g) => [g, false])) as typeof allGates;

function candidate(p: Partial<CandidateLike> & { id: string }): CandidateLike {
  const content = p.content ?? { prompt: `p-${p.id}`, response: "r" };
  return {
    contentHash: contentHashOf(content),
    content,
    trainingEligible: true,
    reviewStatus: "APPROVED",
    datasetSplit: "TRAIN",
    ...allGates,
    ...p,
  };
}

describe("training curation", () => {
  it("defaults to excluded: schema defaults (eligible=false, gates=false, PENDING) never qualify", () => {
    const defaults = candidate({
      id: "d",
      trainingEligible: false,
      reviewStatus: "PENDING",
      datasetSplit: "UNASSIGNED",
      ...noGates,
    });
    expect(isCurated(defaults)).toBe(false);
    expect(selectTrainingRows([defaults], []).included).toHaveLength(0);
  });

  it("requires every one of the nine gates, eligibility and APPROVED review", () => {
    expect(TRAINING_GATES).toHaveLength(9);
    for (const g of TRAINING_GATES) {
      expect(isCurated(candidate({ id: g, [g]: false }))).toBe(false);
    }
    expect(isCurated(candidate({ id: "x", trainingEligible: false }))).toBe(false);
    expect(isCurated(candidate({ id: "y", reviewStatus: "NEEDS_REVISION" }))).toBe(false);
    expect(isCurated(candidate({ id: "ok" }))).toBe(true);
  });

  it("never includes a held-out eval item, matched by stored or recomputed content hash", () => {
    const heldOutContent = { prompt: "give me the full solution", response: "refuse" };
    const byStored = candidate({ id: "stored", contentHash: "abc123" });
    const byContent = candidate({
      id: "content",
      content: heldOutContent,
      contentHash: "different",
    });
    const clean = candidate({ id: "clean" });
    const sel = selectTrainingRows(
      [byStored, byContent, clean],
      ["abc123", contentHashOf(heldOutContent)],
    );
    expect(sel.included.map((c) => c.id)).toEqual(["clean"]);
    expect(sel.excluded).toEqual(
      expect.arrayContaining([
        { id: "stored", reason: "held_out" },
        { id: "content", reason: "held_out" },
      ]),
    );
  });

  it("excludes eval splits and unassigned splits", () => {
    const sel = selectTrainingRows(
      [
        candidate({ id: "v", datasetSplit: "VALIDATION" }),
        candidate({ id: "t", datasetSplit: "TEST" }),
        candidate({ id: "u", datasetSplit: "UNASSIGNED" }),
        candidate({ id: "tr", datasetSplit: "TRAIN" }),
      ],
      [],
    );
    expect(sel.included.map((c) => c.id)).toEqual(["tr"]);
    expect(sel.excluded.find((e) => e.id === "v")?.reason).toBe("eval_split");
    expect(sel.excluded.find((e) => e.id === "u")?.reason).toBe("not_train_split");
  });

  it("hashes content independent of key order", () => {
    expect(contentHashOf({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      contentHashOf({ b: [1, { d: 3, c: 2 }], a: 1 }),
    );
  });
});
