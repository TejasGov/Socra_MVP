import { describe, expect, it } from "vitest";
import {
  buildAnswerKey,
  gradeKeyedAnswer,
  normalizeAnswer,
  parseAnswerKey,
  parseStoredChoices,
  splitAccepted,
} from "@/lib/quiz";
import { mockAuthoring } from "@/server/ai/providers/mock-modes";
import { assignmentDraftSuggestionSchema } from "@/server/ai/schemas";
import { toApiSuggestion } from "@/server/domain/authoring-ai";
import {
  applySuggestion,
  emptyForm,
  fromServer,
  toPayload,
} from "@/app/(faculty)/faculty/assignments/_components/form-model";
import { questionInputSchema } from "@/server/domain/assignments/schema";
import { validateForPublish } from "@/server/domain/assignments/validation";
import { assignmentInputSchema } from "@/server/domain/assignments/schema";
import type { AssignmentInputSerialized } from "@/server/domain/assignments/service";
import { envelope } from "./ai/helpers";

function quizDraft(prompt: string) {
  return mockAuthoring(
    envelope({
      mode: "FACULTY_AUTHORING",
      task: "authoring_generation",
      authoringInput: { prompt, format: "QUIZ", language: "PYTHON", topics: [] },
    }),
  );
}

describe("deterministic quiz grading", () => {
  it("grades multiple choice against the choice id (seed convention)", () => {
    expect(gradeKeyedAnswer("MULTIPLE_CHOICE", { correct: "b" }, "b")).toEqual({ correct: true });
    expect(gradeKeyedAnswer("MULTIPLE_CHOICE", { correct: "b" }, " B ")).toEqual({ correct: true });
    expect(gradeKeyedAnswer("MULTIPLE_CHOICE", { correct: "b" }, "a")).toEqual({ correct: false });
    expect(gradeKeyedAnswer("MULTIPLE_CHOICE", { correct: "b" }, "")).toEqual({ correct: false });
  });

  it("grades the seeded short answer key { accepted, normalize: 'trim' }", () => {
    const key = { accepted: ["6"], normalize: "trim" };
    expect(gradeKeyedAnswer("SHORT_ANSWER", key, "6")).toEqual({ correct: true });
    expect(gradeKeyedAnswer("SHORT_ANSWER", key, "  6\n")).toEqual({ correct: true });
    expect(gradeKeyedAnswer("SHORT_ANSWER", key, "7")).toEqual({ correct: false });
    expect(gradeKeyedAnswer("SHORT_ANSWER", key, "")).toEqual({ correct: false });
  });

  it("accepts any listed answer with loose normalization for traces", () => {
    const key = buildAnswerKey({ type: "SHORT_ANSWER", accepted: splitAccepted("1 2 3||1,2,3") });
    expect(key).toMatchObject({ accepted: ["1 2 3", "1,2,3"], normalize: "loose" });
    expect(gradeKeyedAnswer("SHORT_ANSWER", key, "1\n2\n3")).toEqual({ correct: true });
    expect(gradeKeyedAnswer("SHORT_ANSWER", key, "1, 2, 3")).toEqual({ correct: true });
    expect(gradeKeyedAnswer("SHORT_ANSWER", key, "3 2 1")).toEqual({ correct: false });
    const list = buildAnswerKey({ type: "SHORT_ANSWER", accepted: ["[6, 8, 10]"] });
    expect(gradeKeyedAnswer("SHORT_ANSWER", list, "[6,8,10]")).toEqual({ correct: true });
    const word = buildAnswerKey({ type: "SHORT_ANSWER", accepted: ["None"] });
    expect(gradeKeyedAnswer("SHORT_ANSWER", word, "`none`.")).toEqual({ correct: true });
  });

  it("leaves essays, coding and unkeyed questions for a person", () => {
    expect(gradeKeyedAnswer("ESSAY", { keyPoints: ["x"] }, "x")).toBeNull();
    expect(gradeKeyedAnswer("CODING", { correct: "a" }, "a")).toBeNull();
    expect(gradeKeyedAnswer("SHORT_ANSWER", null, "6")).toBeNull();
    expect(gradeKeyedAnswer("SHORT_ANSWER", { explanation: "only" }, "6")).toBeNull();
    expect(gradeKeyedAnswer("MULTIPLE_CHOICE", { explanation: "only" }, "a")).toBeNull();
  });

  it("normalizes whitespace in every mode except exact", () => {
    expect(normalizeAnswer("  a   b \n c ")).toBe("a b c");
    expect(normalizeAnswer("Hello", "trim")).toBe("Hello");
    expect(normalizeAnswer("'Hello'.", "loose")).toBe("hello");
  });
});

describe("answer key storage", () => {
  it("builds keys in the seed shape and keeps the explanation server side", () => {
    expect(buildAnswerKey({ type: "MULTIPLE_CHOICE", correctChoice: "c", explanation: "why" })).toEqual({
      correct: "c",
      explanation: "why",
    });
    expect(buildAnswerKey({ type: "ESSAY", accepted: ["a", "b"] })).toEqual({ keyPoints: ["a", "b"] });
    expect(buildAnswerKey({ type: "CODING", correctChoice: "a" })).toBeUndefined();
    expect(parseAnswerKey({ accepted: ["6"], normalize: "trim" })).toMatchObject({
      accepted: ["6"],
      normalize: "trim",
      explanation: "",
    });
  });

  it("parses object and legacy string choices", () => {
    expect(parseStoredChoices([{ id: "a", text: "3" }])).toEqual([{ id: "a", text: "3" }]);
    expect(parseStoredChoices(["x"])).toEqual([{ id: "x", text: "x" }]);
    expect(parseStoredChoices(null)).toEqual([]);
  });
});

describe("copilot quiz generation (mock)", () => {
  it("returns five schema-valid, varied questions for a QUIZ request", () => {
    const draft = quizDraft("A CSE 116 quiz on recursion base cases and linked-list traversal");
    expect(() => assignmentDraftSuggestionSchema.parse(draft)).not.toThrow();
    const types = draft.questions.map((q) => q.type);
    expect(types).toHaveLength(5);
    expect(types.filter((t) => t === "MULTIPLE_CHOICE").length).toBeGreaterThanOrEqual(2);
    expect(types).toContain("TRACE");
    expect(types).toContain("SHORT_ANSWER");
    for (const q of draft.questions.filter((x) => x.type === "MULTIPLE_CHOICE")) {
      expect(q.choices).toHaveLength(4);
      expect(q.choices.map((c) => c.id)).toContain(q.answer);
      expect(q.explanation.length).toBeGreaterThan(20);
    }
    for (const q of draft.questions.filter((x) => x.type === "TRACE" || x.type === "SHORT_ANSWER")) {
      expect(q.choices).toEqual([]);
      expect(splitAccepted(q.answer).length).toBeGreaterThan(0);
    }
    expect(draft.questions.every((q) => q.starterCode === "" && q.publicTests.length === 0)).toBe(true);
  });

  it("is deterministic and draws on the detected topics", () => {
    const a = quizDraft("Quiz on BST traversal and big-O complexity");
    const b = quizDraft("Quiz on BST traversal and big-O complexity");
    expect(a).toEqual(b);
    expect(a.title).toMatch(/tree/i);
    expect(a.questions.some((q) => /preorder|traversal/i.test(q.prompt))).toBe(true);
  });

  it("keeps a single CODE question for coding assignments", () => {
    const draft = mockAuthoring(
      envelope({
        mode: "FACULTY_AUTHORING",
        task: "authoring_generation",
        authoringInput: { prompt: "recursion homework", format: "CODING", language: "PYTHON" },
      }),
    );
    expect(draft.questions).toHaveLength(1);
    expect(draft.questions[0]!.type).toBe("CODE");
    expect(draft.questions[0]!.publicTests.length).toBeGreaterThan(0);
  });
});

describe("suggestion -> API -> form -> payload", () => {
  const api = toApiSuggestion(quizDraft("A quiz on recursion and lists"));

  it("maps copilot types onto stored question types", () => {
    const mc = api.questions.find((q) => q.kind === "MULTIPLE_CHOICE")!;
    expect(mc.type).toBe("MULTIPLE_CHOICE");
    expect(mc.choices.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    expect(mc.choices.map((c) => c.id)).toContain(mc.correctChoice);
    const trace = api.questions.find((q) => q.kind === "TRACE")!;
    expect(trace.type).toBe("SHORT_ANSWER");
    expect(trace.acceptedAnswers.length).toBeGreaterThan(0);
    const written = api.questions.find((q) => q.kind === "WRITTEN")!;
    expect(written.type).toBe("ESSAY");
    expect(written.rubric.length).toBeGreaterThan(0);
    expect(api.questions.every((q) => q.points > 0 && q.title.length > 0)).toBe(true);
    expect(api.questions.every((q) => q.publicTests.length === 0 && q.entryPoint === null)).toBe(true);
  });

  it("re-keys model choice ids to a, b, c and keeps the key on the same choice", () => {
    const m = quizDraft("A quiz on recursion");
    const q = m.questions[0]!;
    const correctText = q.choices.find((c) => c.id === q.answer)!.text;
    m.questions[0] = {
      ...q,
      choices: q.choices.map((c, i) => ({ ...c, id: `opt${i + 1}` })),
      answer: `opt${q.choices.findIndex((c) => c.id === q.answer) + 1}`,
    };
    const out = toApiSuggestion(m).questions[0]!;
    expect(out.choices.find((c) => c.id === out.correctChoice)!.text).toBe(correctText);
  });

  it("fills the form and saves choices/answer keys in the seed convention", () => {
    const form = applySuggestion({ ...emptyForm("course-1"), format: "QUIZ" }, api, "sugg-1");
    expect(form.questions).toHaveLength(api.questions.length);
    const payload = toPayload(form) as { questions: Array<Record<string, unknown>> };
    for (const [i, q] of payload.questions.entries()) {
      expect(() => questionInputSchema.parse(q)).not.toThrow();
      const src = api.questions[i]!;
      expect(q.type).toBe(src.type);
      expect(q.starterCode).toBeNull();
      if (src.type === "MULTIPLE_CHOICE") {
        expect(q.choices).toEqual(src.choices);
        expect(q.answerKey).toEqual({ correct: src.correctChoice, explanation: src.explanation });
      } else if (src.type === "SHORT_ANSWER") {
        expect(q.choices).toBeNull();
        expect(q.answerKey).toEqual({
          accepted: src.acceptedAnswers,
          normalize: "loose",
          explanation: src.explanation,
        });
      } else {
        expect(q.answerKey).toMatchObject({ keyPoints: src.acceptedAnswers });
      }
    }
    const input = assignmentInputSchema.parse({ ...payload, title: "E2E quiz", topicKeys: [] });
    const errors = validateForPublish(input).filter((x) => x.severity === "error");
    expect(errors).toEqual([]);
  });

  it("round-trips the seeded Quiz 2 shape through the edit form unchanged", () => {
    const seeded = {
      ...(toPayload(emptyForm("course-1")) as object),
      format: "QUIZ",
      openAt: null,
      dueAt: null,
      closeAt: null,
      questions: [
        {
          id: "q2",
          title: "Count the calls",
          prompt: "How many calls?",
          type: "MULTIPLE_CHOICE",
          points: 2,
          language: null,
          starterCode: null,
          entryPoint: null,
          referenceSolution: null,
          choices: [
            { id: "a", text: "3" },
            { id: "b", text: "4" },
          ],
          answerKey: { correct: "b" },
          difficulty: 2,
          topicKeys: [],
          tests: [],
          rubric: [],
          scaffold: [],
        },
        {
          id: "q1",
          title: "Trace f(3)",
          prompt: "What value?",
          type: "SHORT_ANSWER",
          points: 2,
          language: null,
          starterCode: null,
          entryPoint: null,
          referenceSolution: null,
          choices: null,
          answerKey: { accepted: ["6"], normalize: "trim" },
          difficulty: 2,
          topicKeys: [],
          tests: [],
          rubric: [],
          scaffold: [],
        },
      ],
    } as unknown as AssignmentInputSerialized;
    const form = fromServer(seeded);
    expect(form.questions[0]!.correctChoice).toBe("b");
    const payload = toPayload(form) as { questions: Array<Record<string, unknown>> };
    expect(payload.questions[0]!.choices).toEqual([
      { id: "a", text: "3" },
      { id: "b", text: "4" },
    ]);
    expect(payload.questions[0]!.answerKey).toEqual({ correct: "b" });
    expect(payload.questions[1]!.answerKey).toEqual({ accepted: ["6"], normalize: "trim" });
  });

  it("maps legacy plain-string choices to ids and keeps the correct one", () => {
    const legacy = {
      ...(toPayload(emptyForm("c")) as object),
      openAt: null,
      dueAt: null,
      closeAt: null,
      questions: [
        {
          title: "Q",
          prompt: "P",
          type: "MULTIPLE_CHOICE",
          points: 1,
          choices: ["x", "y"],
          answerKey: { correct: "y" },
          difficulty: 2,
          topicKeys: [],
          tests: [],
          rubric: [],
          scaffold: [],
        },
      ],
    } as unknown as AssignmentInputSerialized;
    const payload = toPayload(fromServer(legacy)) as { questions: Array<Record<string, unknown>> };
    expect(payload.questions[0]!.choices).toEqual([
      { id: "a", text: "x" },
      { id: "b", text: "y" },
    ]);
    expect(payload.questions[0]!.answerKey).toEqual({ correct: "b" });
  });
});
