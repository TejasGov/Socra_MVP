import { describe, expect, it } from "vitest";
import {
  adaptDifficulty,
  checkAnswer,
  chooseTopic,
  normalizeOutput,
  normalizeText,
  pickCandidate,
  shouldScaffold,
  startingDifficulty,
  textMatches,
} from "@/server/domain/practice/logic";

const r = (correct: boolean, difficulty: number) => ({ correct, difficulty });

describe("answer normalization", () => {
  it("normalizes case, whitespace, quotes and trailing punctuation", () => {
    expect(normalizeText('  "Base   Case." ')).toBe("base case");
  });
  it("matches numbers numerically", () => {
    expect(textMatches("3.0", "3")).toBe(true);
    expect(textMatches("1,000", "1000")).toBe(true);
    expect(textMatches("3", "4")).toBe(false);
  });
  it("normalizes output whitespace", () => {
    expect(normalizeOutput("1 \r\n2\r\n\r\n")).toBe("1\n2");
  });
});

describe("checkAnswer", () => {
  const mc = {
    type: "MULTIPLE_CHOICE" as const,
    answer: null,
    choices: [
      { id: "A", text: "It never stops", correct: false },
      { id: "B", text: "It reaches the base case", correct: true },
      { id: "C", text: "It returns None", correct: false },
    ],
  };
  it("multiple choice by id, letter, or text", () => {
    expect(checkAnswer(mc, "B").correct).toBe(true);
    expect(checkAnswer(mc, "b)").correct).toBe(true);
    expect(checkAnswer(mc, "It reaches the base case.").correct).toBe(true);
    expect(checkAnswer(mc, "A").correct).toBe(false);
    expect(checkAnswer(mc, "zzz").correct).toBe(false);
  });
  it("multiple choice with string choices and answer letter", () => {
    const item = { type: "MULTIPLE_CHOICE" as const, answer: "C", choices: ["x", "y", "z"] };
    expect(checkAnswer(item, "z").correct).toBe(true);
    expect(checkAnswer(item, "x").correct).toBe(false);
  });
  it("short answer uses accepted list", () => {
    const item = {
      type: "SHORT_ANSWER" as const,
      answer: "base case || terminating condition",
      choices: null,
    };
    expect(checkAnswer(item, "Terminating condition").correct).toBe(true);
    expect(checkAnswer(item, "loop").correct).toBe(false);
    expect(
      checkAnswer({ ...item, answer: null, rubric: { acceptedAnswers: ["stack"] } }, "Stack.")
        .correct,
    ).toBe(true);
  });
  it("trace compares predicted output ignoring trailing whitespace", () => {
    const item = { type: "TRACE" as const, answer: "3\n2\n1" };
    expect(checkAnswer(item, "3\r\n2\n1  \n").correct).toBe(true);
    expect(checkAnswer(item, "1\n2\n3").correct).toBe(false);
  });
  it("free response and items without a key are not auto-graded", () => {
    expect(checkAnswer({ type: "EXPLAIN", answer: "x" }, "y")).toEqual({
      correct: null,
      method: "NONE",
    });
    expect(checkAnswer({ type: "SHORT_ANSWER", answer: null }, "y").correct).toBeNull();
  });
});

describe("adaptation", () => {
  it("two consecutive correct raises difficulty", () => {
    expect(adaptDifficulty(2, [r(true, 2), r(true, 2)])).toEqual({
      difficulty: 3,
      scaffold: false,
      changed: "UP",
    });
  });
  it("two consecutive wrong lowers difficulty and scaffolds", () => {
    expect(adaptDifficulty(3, [r(false, 3), r(false, 3)])).toEqual({
      difficulty: 2,
      scaffold: true,
      changed: "DOWN",
    });
  });
  it("mixed results hold", () => {
    expect(adaptDifficulty(3, [r(true, 3), r(false, 3)]).changed).toBe("NONE");
  });
  it("streak resets after a change (results at the old level do not count)", () => {
    expect(adaptDifficulty(3, [r(true, 2), r(true, 2)]).changed).toBe("NONE");
    expect(adaptDifficulty(3, [r(true, 2), r(true, 2), r(true, 3)]).changed).toBe("NONE");
  });
  it("clamps to 1..5", () => {
    expect(adaptDifficulty(5, [r(true, 5), r(true, 5)]).difficulty).toBe(5);
    expect(adaptDifficulty(1, [r(false, 1), r(false, 1)]).difficulty).toBe(1);
  });
  it("scaffold flag and starting difficulty", () => {
    expect(shouldScaffold([r(true, 2), r(false, 2), r(false, 2)])).toBe(true);
    expect(shouldScaffold([r(false, 2), r(true, 2)])).toBe(false);
    expect(startingDifficulty("NEEDS_REINFORCEMENT")).toBe(2);
    expect(startingDifficulty("DEVELOPING")).toBe(3);
    expect(startingDifficulty(null)).toBe(2);
  });
});

describe("selection", () => {
  const items = [
    { id: "a", difficulty: 2 },
    { id: "b", difficulty: 2 },
    { id: "c", difficulty: 3 },
    { id: "d", difficulty: 5 },
  ];
  it("never returns a recently seen item", () => {
    const recent = new Set(["a", "b"]);
    for (let i = 0; i < 20; i++) {
      const p = pickCandidate(items, { target: 2, recentItemIds: recent, seed: `s${i}` });
      expect(p?.id).toBe("c");
    }
  });
  it("returns null when nothing is close enough or all are recent", () => {
    expect(pickCandidate(items, { target: 2, recentItemIds: new Set(["a", "b", "c"]) })).toBeNull();
    expect(
      pickCandidate([{ id: "d", difficulty: 5 }], { target: 2, recentItemIds: new Set() }),
    ).toBeNull();
  });
  it("allowRecent permits a repeat as a last resort", () => {
    expect(
      pickCandidate(items, {
        target: 2,
        recentItemIds: new Set(["a", "b", "c"]),
        allowRecent: true,
      }),
    ).not.toBeNull();
  });
  it("scaffold prefers the easier side on ties", () => {
    const p = pickCandidate(
      [
        { id: "x", difficulty: 3 },
        { id: "y", difficulty: 1 },
      ],
      { target: 2, recentItemIds: new Set(), scaffold: true },
    );
    expect(p?.id).toBe("y");
  });
  it("prioritizes needs-reinforcement topics, rotating", () => {
    const base = { sessionTopicId: null, reinforcementTopicIds: ["t1", "t2"] };
    expect(chooseTopic({ ...base, servedCount: 0 })).toBe("t1");
    expect(chooseTopic({ ...base, servedCount: 1 })).toBe("t2");
    expect(chooseTopic({ ...base, servedCount: 2 })).toBe("t1");
    expect(
      chooseTopic({ sessionTopicId: "z", reinforcementTopicIds: ["t1"], servedCount: 0 }),
    ).toBe("z");
    expect(
      chooseTopic({ sessionTopicId: null, reinforcementTopicIds: [], servedCount: 0 }),
    ).toBeNull();
  });
});
