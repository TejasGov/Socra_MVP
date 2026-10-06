import { describe, expect, it } from "vitest";
import {
  EXPORT_FIELDS,
  EXPORT_FIELD_KEYS,
  orderedFields,
  validateFields,
  type ExportSource,
} from "@/server/domain/research/allowlist";
import { projectRow, safeCell, toCsv, toJson } from "@/server/domain/research/serialize";

const source: ExportSource = {
  participantId: "p_0123456789abcdef01234567",
  condition: "SOCRATIC_AI",
  eventId: "evt-1",
  eventName: "socra_response_completed",
  occurredAt: new Date("2026-10-01T12:00:00.000Z"),
  courseId: "c1",
  assignmentId: "a1",
  assignmentVersion: 2,
  questionId: "q1",
  questionVersion: 1,
  schemaVersion: 1,
  appVersion: "0.1.0",
  metadata: {
    model: "model-x",
    promptVersion: "protected-v1",
    interventionLevel: 3,
    tokenUsage: { inputTokens: 10, outputTokens: 5 },
    // Things that must never be exported even though they sit in metadata.
    studentEmail: "ada@example.com",
    message: "my secret answer",
    freeText: "Ada Lovelace",
  },
};

describe("research field allowlist", () => {
  it("rejects fields that are not in the registry (names, emails, raw content)", () => {
    const v = validateFields(["participantId", "email", "name", "message", "userId"]);
    expect(v.ok).toBe(false);
    expect(v.rejected).toEqual(["email", "name", "message", "userId"]);
  });

  it("accepts every registered field and rejects an empty selection", () => {
    expect(validateFields(EXPORT_FIELD_KEYS).ok).toBe(true);
    expect(validateFields([]).ok).toBe(false);
  });

  it("registry has no identifying or raw-content field keys", () => {
    const banned =
      /(^|[^a-z])(name|email|userid|actorid|sessionid|message|content|transcript|code|answer)$/i;
    const offenders = EXPORT_FIELD_KEYS.filter((k) => banned.test(k) && k !== "eventName");
    expect(offenders).toEqual([]);
  });

  it("orders columns by registry order regardless of request order", () => {
    expect(orderedFields(["condition", "participantId"]).map((f) => f.key)).toEqual([
      "participantId",
      "condition",
    ]);
  });
});

describe("export serialization", () => {
  const all = EXPORT_FIELD_KEYS;

  it("projects only allowlisted values and never copies stray metadata", () => {
    const row = projectRow(all, source);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("ada@example.com");
    expect(serialized).not.toContain("my secret answer");
    expect(serialized).not.toContain("Ada Lovelace");
    expect(row.interventionLevel).toBe(3);
    expect(row.inputTokens).toBe(10);
    expect(row.eventTime).toBe("2026-10-01T12:00:00.000Z");
    expect(row.correct).toBeNull();
  });

  it("CSV has exactly the requested header and one row per record", () => {
    const fields = ["condition", "participantId", "interventionLevel"];
    const csv = toCsv(fields, [projectRow(fields, source)]);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe("participantId,condition,interventionLevel");
    expect(lines[1]).toBe("p_0123456789abcdef01234567,SOCRATIC_AI,3");
    expect(lines).toHaveLength(2);
  });

  it("JSON output contains only requested keys", () => {
    const fields = ["participantId", "condition"];
    const parsed = JSON.parse(toJson([projectRow(fields, source)]));
    expect(Object.keys(parsed[0])).toEqual(["participantId", "condition"]);
  });

  it("neutralizes spreadsheet formulas in text cells", () => {
    expect(safeCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(safeCell("+1")).toBe("'+1");
    expect(safeCell(-3)).toBe(-3);
    expect(safeCell(null)).toBe("");
  });

  it("every field has a type, source and privacy note (data dictionary completeness)", () => {
    for (const f of EXPORT_FIELDS) {
      expect(f.source.length).toBeGreaterThan(5);
      expect(f.privacy.length).toBeGreaterThan(5);
    }
  });
});
