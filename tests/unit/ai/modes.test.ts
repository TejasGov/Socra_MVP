import { describe, expect, it } from "vitest";
import { buildProviderRequest } from "@/server/ai/gateway";
import { applyContextRules, getModeDefinition, MODE_DEFINITIONS } from "@/server/ai/modes";
import { AI_MODES } from "@/server/ai/types";
import { TASK_TIERS } from "@/server/ai/provider";
import { decideBudget, SOCRA_LIMIT_MESSAGE } from "@/server/domain/socra/budget";
import { inventedNumbers } from "@/server/domain/authoring-ai";
import { envelope } from "./helpers";

const withSolution = () =>
  envelope({ assignment: { ...envelope().assignment!, referenceSolution: "def factorial(n): return 1" } });

describe("AI modes", () => {
  it("defines every mode with its own prompt and policy versions", () => {
    for (const m of AI_MODES) {
      const d = getModeDefinition(m);
      expect(d.mode).toBe(m);
      expect(d.promptVersion).toMatch(/v\d/);
      expect(d.policyVersion).toMatch(/v\d/);
      expect(d.contextRules.hiddenTests).toBe(false);
    }
    expect(new Set(Object.values(MODE_DEFINITIONS).map((d) => d.promptVersion)).size).toBe(AI_MODES.length);
  });

  it("protected mode never carries the reference solution; review mode does", () => {
    const p = applyContextRules(getModeDefinition("PROTECTED_ASSESSMENT").contextRules, withSolution());
    expect(p.assignment?.referenceSolution).toBeUndefined();
    const r = applyContextRules(getModeDefinition("POST_ASSESSMENT_REVIEW").contextRules, { ...withSolution(), mode: "POST_ASSESSMENT_REVIEW" });
    expect(r.assignment?.referenceSolution).toContain("factorial");
    const { request } = buildProviderRequest(withSolution(), { task: "socratic_turn" });
    expect(request.messages.map((m) => m.content).join("\n")).not.toContain("Reference solution");
  });

  it("protected prompt carries the L0-L6 ladder and the MUST NOT list", () => {
    const sys = getModeDefinition("PROTECTED_ASSESSMENT").buildSystemPrompt(envelope());
    expect(sys).toContain("L6 Escalation");
    expect(sys).toContain("MUST NOT");
    expect(sys).toMatch(/hidden tests/);
    const unrestricted = getModeDefinition("PROTECTED_ASSESSMENT").buildSystemPrompt(envelope({ researchCondition: "UNRESTRICTED_AI" }));
    expect(unrestricted).toContain("UNRESTRICTED_AI");
  });

  it("routes tasks to model tiers and keeps the stable prefix first", () => {
    expect(TASK_TIERS.socratic_turn).toBe("protected");
    expect(TASK_TIERS.analytics_brief).toBe("economy");
    const { request } = buildProviderRequest(envelope(), { task: "socratic_turn" });
    expect(request.tier).toBe("protected");
    expect(request.messages[0]!.role).toBe("system");
    expect(request.messages.at(-1)!.content).toContain("Why doesn't my code run?");
  });

  it("budget decisions produce the exact PRD message", () => {
    const base = {
      killSwitch: false,
      courseAiDisabled: false,
      courseSpendUsd: 0,
      courseBudgetUsd: 100,
      courseHardStop: true,
      sessionTurnCount: 0,
      maxTurnsPerSession: 30,
      userTurnsToday: 0,
      maxTurnsPerDay: 150,
      userTurnsLastMinute: 0,
      maxTurnsPerMinute: 12,
    };
    expect(decideBudget(base).ok).toBe(true);
    const s = decideBudget({ ...base, sessionTurnCount: 30 });
    expect(s).toEqual({ ok: false, limit: "session_turns", message: SOCRA_LIMIT_MESSAGE });
    expect(decideBudget({ ...base, courseSpendUsd: 100 })).toMatchObject({ limit: "course_budget" });
    expect(decideBudget({ ...base, killSwitch: true })).toMatchObject({ limit: "kill_switch" });
    expect(SOCRA_LIMIT_MESSAGE).toBe(
      "Socra has provided the maximum guided assistance available for this activity. Please take your current work and questions to your TA, office hours, or instructor.",
    );
  });

  it("teaching-brief validation rejects invented numbers", () => {
    const metrics = { completion: { numerator: 17, denominator: 31, value: 0.548 } };
    expect(inventedNumbers("17 of 31 students completed (54.8%).", metrics)).toEqual([]);
    expect(inventedNumbers("Completion rose by 12 points.", metrics)).toEqual(["12"]);
  });
});
