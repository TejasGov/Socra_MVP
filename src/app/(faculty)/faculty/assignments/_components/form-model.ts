import {
  DEFAULT_ALLOWED_BEHAVIORS,
  DEFAULT_FORBIDDEN_BEHAVIORS,
  DEFAULT_HINT_LADDER,
} from "@/server/domain/assignments/schema";
import type { AssignmentInputSerialized } from "@/server/domain/assignments/service";
import {
  buildAnswerKey,
  choiceId,
  parseAnswerKey,
  parseStoredChoices,
  splitAccepted,
  type NormalizeMode,
} from "@/lib/quiz";

/**
 * Client-side form model. Tests keep args/expected as JSON text so faculty can type them; they are parsed on save.
 * (Type-only import from the service: nothing server-side is bundled.)
 */

export type Language = "PYTHON" | "JAVASCRIPT" | "SCALA";
export type Visibility = "PUBLIC" | "HIDDEN" | "DIAGNOSTIC";

export interface TestUi {
  key: string;
  name: string;
  visibility: Visibility;
  weight: number;
  kind: "function" | "stdio";
  entryPoint: string;
  argsText: string;
  expectedText: string;
  stdin: string;
  expectedStdout: string;
  failureHint: string;
}

export interface CriterionUi {
  key: string;
  title: string;
  description: string;
  maxPoints: number;
}

export interface ScaffoldUi {
  key: string;
  title: string;
  instructions: string;
  hint: string;
}

export interface ChoiceUi {
  key: string;
  /** Stored choice id (a, b, c, ...); the answer key and student answers refer to it. */
  id: string;
  text: string;
}

export interface QuestionUi {
  key: string;
  id?: string;
  title: string;
  prompt: string;
  type: "CODING" | "SHORT_ANSWER" | "ESSAY" | "MULTIPLE_CHOICE";
  points: number;
  language: Language | "";
  entryPoint: string;
  starterCode: string;
  referenceSolution: string;
  /** MULTIPLE_CHOICE options. */
  choices: ChoiceUi[];
  /** Id of the correct choice (MULTIPLE_CHOICE). */
  correctChoice: string;
  /** SHORT_ANSWER: accepted answers; ESSAY: key points. One per line. */
  acceptedText: string;
  /** Shown to students in review mode after solutions are released. */
  explanation: string;
  /** Short-answer comparison mode kept from the stored key. */
  normalize: NormalizeMode;
  difficulty: number;
  topicKeys: string[];
  tests: TestUi[];
  rubric: CriterionUi[];
  scaffold: ScaffoldUi[];
}

export interface PolicyUi {
  maxInterventionLevel: number;
  hintLadder: Array<{ level: number; guidance: string }>;
  allowedBehaviors: string[];
  forbiddenBehaviors: string[];
  allowDirectSyntaxHelp: boolean;
  allowResourceRetrieval: boolean;
  maxTurnsPerSession: string;
  maxTurnsPerDay: string;
  escalationMessage: string;
  notes: string;
}

export interface FormState {
  courseId: string;
  title: string;
  description: string;
  format: "CODING" | "WRITTEN" | "QUIZ";
  language: Language | "";
  openAt: string;
  dueAt: string;
  closeAt: string;
  attemptLimit: string;
  allowResubmission: boolean;
  solutionReleaseMode: "NEVER" | "ON_CLOSE" | "MANUAL";
  resourceScope: "ALL_COURSE_RESOURCES" | "SELECTED_RESOURCES" | "NONE";
  resourceIds: string[];
  learningObjectives: string[];
  topicKeys: string[];
  questions: QuestionUi[];
  policy: PolicyUi;
  aiSuggestionId?: string;
}

let counter = 0;
export const newKey = () => `k${Date.now().toString(36)}${(counter++).toString(36)}`;

export function emptyTest(visibility: Visibility = "PUBLIC"): TestUi {
  return {
    key: newKey(),
    name: "",
    visibility,
    weight: 1,
    kind: "function",
    entryPoint: "",
    argsText: "[]",
    expectedText: "",
    stdin: "",
    expectedStdout: "",
    failureHint: "",
  };
}

export function emptyQuestion(format: FormState["format"], language: Language | ""): QuestionUi {
  const type: QuestionUi["type"] =
    format === "CODING" ? "CODING" : format === "QUIZ" ? "MULTIPLE_CHOICE" : "SHORT_ANSWER";
  return {
    key: newKey(),
    title: "",
    prompt: "",
    type,
    points: 10,
    language,
    entryPoint: "",
    starterCode: "",
    referenceSolution: "",
    choices:
      type === "MULTIPLE_CHOICE"
        ? [0, 1, 2, 3].map((i) => ({ key: newKey(), id: choiceId(i), text: "" }))
        : [],
    correctChoice: "",
    acceptedText: "",
    explanation: "",
    normalize: "loose",
    difficulty: 2,
    topicKeys: [],
    tests: [],
    rubric: [],
    scaffold: [],
  };
}

export function defaultPolicy(): PolicyUi {
  return {
    maxInterventionLevel: 5,
    hintLadder: DEFAULT_HINT_LADDER.map((h) => ({ ...h })),
    allowedBehaviors: [...DEFAULT_ALLOWED_BEHAVIORS],
    forbiddenBehaviors: [...DEFAULT_FORBIDDEN_BEHAVIORS],
    allowDirectSyntaxHelp: true,
    allowResourceRetrieval: true,
    maxTurnsPerSession: "",
    maxTurnsPerDay: "",
    escalationMessage: "",
    notes: "",
  };
}

export function emptyForm(courseId: string): FormState {
  return {
    courseId,
    title: "",
    description: "",
    format: "CODING",
    language: "PYTHON",
    openAt: "",
    dueAt: "",
    closeAt: "",
    attemptLimit: "",
    allowResubmission: true,
    solutionReleaseMode: "MANUAL",
    resourceScope: "ALL_COURSE_RESOURCES",
    resourceIds: [],
    learningObjectives: [],
    topicKeys: [],
    questions: [],
    policy: defaultPolicy(),
  };
}

// ---- date helpers: <input type="datetime-local"> uses local time without zone ----------------------------------

export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const localInputToIso = (v: string): string | null => (v ? new Date(v).toISOString() : null);

// ---- server -> form ---------------------------------------------------------------------------------------------

const show = (v: unknown): string => (v === undefined ? "" : JSON.stringify(v));

export function fromServer(input: AssignmentInputSerialized): FormState {
  return {
    courseId: input.courseId,
    title: input.title,
    description: input.description,
    format: input.format,
    language: input.language ?? "",
    openAt: isoToLocalInput(input.openAt),
    dueAt: isoToLocalInput(input.dueAt),
    closeAt: isoToLocalInput(input.closeAt),
    attemptLimit: input.attemptLimit ? String(input.attemptLimit) : "",
    allowResubmission: input.allowResubmission,
    solutionReleaseMode: input.solutionReleaseMode,
    resourceScope: input.resourceScope,
    resourceIds: input.resourceIds,
    learningObjectives: input.learningObjectives,
    topicKeys: input.topicKeys,
    questions: input.questions.map((q) => {
      const key = parseAnswerKey(q.answerKey);
      return {
        key: newKey(),
        id: q.id,
        title: q.title,
        prompt: q.prompt,
        type: q.type,
        points: q.points,
        language: q.language ?? "",
        entryPoint: q.entryPoint ?? "",
        starterCode: q.starterCode ?? "",
        referenceSolution: q.referenceSolution ?? "",
        choices: choicesFromStored(q.choices),
        correctChoice: correctIdFromStored(q.choices, key.correct),
        acceptedText: (q.type === "ESSAY" ? key.keyPoints : key.accepted).join("\n"),
        explanation: key.explanation,
        normalize: q.answerKey ? key.normalize : "loose",
        difficulty: q.difficulty,
        topicKeys: q.topicKeys,
        tests: q.tests.map((t) => ({
          key: newKey(),
          name: t.name,
          visibility: t.visibility,
          weight: t.weight,
          kind: t.kind,
          entryPoint: t.entryPoint ?? "",
          argsText: show(t.args ?? []),
          expectedText: show(t.expectedReturn),
          stdin: t.stdin ?? "",
          expectedStdout: t.expectedStdout ?? "",
          failureHint: t.failureHint ?? "",
        })),
        rubric: q.rubric.map((c) => ({
          key: newKey(),
          title: c.title,
          description: c.description,
          maxPoints: c.maxPoints,
        })),
        scaffold: q.scaffold.map((s) => ({
          key: newKey(),
          title: s.title,
          instructions: s.instructions,
          hint: s.hint ?? "",
        })),
      };
    }),
    policy: {
      maxInterventionLevel: input.policy.maxInterventionLevel,
      hintLadder: input.policy.hintLadder,
      allowedBehaviors: input.policy.allowedBehaviors,
      forbiddenBehaviors: input.policy.forbiddenBehaviors,
      allowDirectSyntaxHelp: input.policy.allowDirectSyntaxHelp,
      allowResourceRetrieval: input.policy.allowResourceRetrieval,
      maxTurnsPerSession: input.policy.maxTurnsPerSession
        ? String(input.policy.maxTurnsPerSession)
        : "",
      maxTurnsPerDay: input.policy.maxTurnsPerDay ? String(input.policy.maxTurnsPerDay) : "",
      escalationMessage: input.policy.escalationMessage ?? "",
      notes: input.policy.notes ?? "",
    },
  };
}

const isLegacyChoices = (raw: unknown): boolean =>
  Array.isArray(raw) && raw.every((c) => typeof c === "string");

/** Stored choices -> editable rows. Legacy plain-string choices get seed-style ids (a, b, ...). */
function choicesFromStored(raw: unknown): ChoiceUi[] {
  const legacy = isLegacyChoices(raw);
  return parseStoredChoices(raw).map((c, i) => ({
    key: newKey(),
    id: legacy ? choiceId(i) : c.id,
    text: c.text,
  }));
}

function correctIdFromStored(raw: unknown, correct: string | null): string {
  if (correct === null) return "";
  const choices = parseStoredChoices(raw);
  const i = choices.findIndex((c) => c.id === correct);
  if (i < 0) return "";
  return isLegacyChoices(raw) ? choiceId(i) : choices[i]!.id;
}

/** Next unused seed-style choice id. */
export function nextChoiceId(choices: ChoiceUi[]): string {
  const used = new Set(choices.map((c) => c.id));
  for (let i = 0; i < 26; i++) if (!used.has(choiceId(i))) return choiceId(i);
  return newKey();
}

/** Question fields that become QuestionVersion.choices / answerKey (seed convention, see src/lib/quiz.ts). */
export function questionKeyPayload(q: QuestionUi): {
  choices: Array<{ id: string; text: string }> | null;
  answerKey: Record<string, unknown> | undefined;
} {
  const choices =
    q.type === "MULTIPLE_CHOICE"
      ? q.choices.filter((c) => c.text.trim()).map((c) => ({ id: c.id, text: c.text.trim() }))
      : null;
  const correct =
    choices && choices.some((c) => c.id === q.correctChoice) ? q.correctChoice : undefined;
  return {
    choices,
    answerKey: buildAnswerKey({
      type: q.type,
      correctChoice: correct,
      accepted: splitAccepted(q.acceptedText),
      explanation: q.explanation,
      normalize: q.normalize,
    }),
  };
}

// ---- form -> payload --------------------------------------------------------------------------------------------

export class FormError extends Error {}

function parseJson(text: string, what: string, fallback: unknown): unknown {
  const t = text.trim();
  if (t === "") return fallback;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    throw new FormError(
      `${what} must be valid JSON (for example [1, 2] or "abc"). Got: ${t.slice(0, 40)}`,
    );
  }
}

export function toPayload(f: FormState): Record<string, unknown> {
  return {
    courseId: f.courseId,
    title: f.title,
    description: f.description,
    format: f.format,
    language: f.language || null,
    openAt: localInputToIso(f.openAt),
    dueAt: localInputToIso(f.dueAt),
    closeAt: localInputToIso(f.closeAt),
    attemptLimit: f.attemptLimit ? Number(f.attemptLimit) : null,
    allowResubmission: f.allowResubmission,
    solutionReleaseMode: f.solutionReleaseMode,
    resourceScope: f.resourceScope,
    resourceIds: f.resourceScope === "SELECTED_RESOURCES" ? f.resourceIds : [],
    learningObjectives: f.learningObjectives.map((o) => o.trim()).filter(Boolean),
    topicKeys: f.topicKeys,
    aiSuggestionId: f.aiSuggestionId,
    questions: f.questions.map((q, qi) => {
      const { choices, answerKey } = questionKeyPayload(q);
      const coding = q.type === "CODING";
      return {
        id: q.id,
        title: q.title,
        prompt: q.prompt,
        type: q.type,
        points: Number(q.points) || 0,
        language: q.type === "CODING" ? q.language || f.language || null : null,
        starterCode: coding ? q.starterCode || null : null,
        entryPoint: coding ? q.entryPoint || null : null,
        referenceSolution: q.referenceSolution || null,
        choices,
        answerKey,
        difficulty: q.difficulty,
        topicKeys: q.topicKeys,
        tests:
          q.type === "CODING"
            ? q.tests.map((t, ti) => ({
                name: t.name || `Test ${ti + 1}`,
                visibility: t.visibility,
                weight: Number(t.weight) || 0,
                kind: t.kind,
                entryPoint: t.kind === "function" ? t.entryPoint || undefined : undefined,
                args:
                  t.kind === "function"
                    ? (parseJson(
                        t.argsText,
                        `Question ${qi + 1}, test ${ti + 1} arguments`,
                        [],
                      ) as unknown[])
                    : undefined,
                expectedReturn:
                  t.kind === "function"
                    ? parseJson(
                        t.expectedText,
                        `Question ${qi + 1}, test ${ti + 1} expected value`,
                        undefined,
                      )
                    : undefined,
                stdin: t.kind === "stdio" ? t.stdin : undefined,
                expectedStdout: t.kind === "stdio" ? t.expectedStdout : undefined,
                failureHint: t.failureHint || undefined,
              }))
            : [],
        rubric: q.rubric.map((c) => ({
          title: c.title,
          description: c.description,
          maxPoints: Number(c.maxPoints) || 0,
        })),
        scaffold: q.scaffold.map((s) => ({
          title: s.title,
          instructions: s.instructions,
          hint: s.hint || undefined,
        })),
      };
    }),
    policy: {
      maxInterventionLevel: f.policy.maxInterventionLevel,
      hintLadder: f.policy.hintLadder,
      allowedBehaviors: f.policy.allowedBehaviors.filter(Boolean),
      forbiddenBehaviors: f.policy.forbiddenBehaviors.filter(Boolean),
      allowDirectSyntaxHelp: f.policy.allowDirectSyntaxHelp,
      allowResourceRetrieval: f.policy.allowResourceRetrieval,
      maxTurnsPerSession: f.policy.maxTurnsPerSession ? Number(f.policy.maxTurnsPerSession) : null,
      maxTurnsPerDay: f.policy.maxTurnsPerDay ? Number(f.policy.maxTurnsPerDay) : null,
      escalationMessage: f.policy.escalationMessage || null,
      notes: f.policy.notes || null,
    },
  };
}

// ---- copilot suggestion -> form ---------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};

function suggestedTest(raw: unknown, visibility: Visibility, i: number): TestUi {
  const t = emptyTest(visibility);
  if (typeof raw === "string") {
    t.name = raw.slice(0, 120);
    return t;
  }
  const o = obj(raw);
  t.name =
    str(o.name) ||
    str(o.description) ||
    `${visibility === "PUBLIC" ? "Public" : "Hidden"} test ${i + 1}`;
  t.weight = typeof o.weight === "number" ? o.weight : 1;
  if (typeof o.stdin === "string" || typeof o.expectedStdout === "string") {
    t.kind = "stdio";
    t.stdin = str(o.stdin);
    t.expectedStdout = str(o.expectedStdout);
  } else {
    t.kind = "function";
    t.entryPoint = str(o.entryPoint) || str(o.function);
    const args = o.args ?? o.input ?? o.inputs;
    t.argsText = show(Array.isArray(args) ? args : args === undefined ? [] : [args]);
    const exp = o.expectedReturn ?? o.expected ?? o.returns ?? o.output;
    t.expectedText = show(exp);
  }
  return t;
}

/** Maps a copilot suggestion onto the form. Tolerant of shape differences; nothing is saved or published. */
export function applySuggestion(
  current: FormState,
  raw: unknown,
  suggestionId?: string,
): FormState {
  const s = obj(obj(raw).suggestion ?? raw);
  const next: FormState = { ...current, aiSuggestionId: suggestionId ?? current.aiSuggestionId };
  if (str(s.title)) next.title = str(s.title);
  if (str(s.description)) next.description = str(s.description);
  const los = arr(s.learningObjectives).filter((x): x is string => typeof x === "string");
  if (los.length) next.learningObjectives = los;
  const topics = arr(s.topicSlugs ?? s.topicKeys).filter((x): x is string => typeof x === "string");
  if (topics.length) next.topicKeys = topics;
  const scaffold: ScaffoldUi[] = arr(s.scaffold).map((x) => {
    const o = obj(x);
    return {
      key: newKey(),
      title: str(o.stage) || str(o.title),
      instructions: str(o.instructions),
      hint: str(o.hint),
    };
  });
  const qs = arr(s.questions).map((x, qi): QuestionUi => {
    const o = obj(x);
    const q = emptyQuestion(next.format, next.language);
    const type = str(o.type);
    if (
      type === "CODING" ||
      type === "SHORT_ANSWER" ||
      type === "ESSAY" ||
      type === "MULTIPLE_CHOICE"
    )
      q.type = type;
    q.title = str(o.title) || `Question ${qi + 1}`;
    q.explanation = str(o.explanation);
    q.choices = arr(o.choices).map((c, ci) => {
      const co = obj(c);
      return {
        key: newKey(),
        id: str(co.id) || choiceId(ci),
        text: typeof c === "string" ? c : str(co.text),
      };
    });
    const correct = str(o.correctChoice);
    q.correctChoice = q.choices.some((c) => c.id === correct) ? correct : "";
    q.acceptedText = arr(o.acceptedAnswers)
      .filter((a): a is string => typeof a === "string")
      .join("\n");
    q.prompt = str(o.prompt);
    q.starterCode = str(o.starterCode);
    q.entryPoint = str(o.entryPoint);
    if (typeof o.points === "number") q.points = o.points;
    q.tests = [
      ...arr(o.publicTests).map((t, i) => suggestedTest(t, "PUBLIC", i)),
      ...arr(o.hiddenTestSuggestions ?? o.hiddenTests).map((t, i) => suggestedTest(t, "HIDDEN", i)),
    ];
    if (!q.entryPoint) q.entryPoint = q.tests.find((t) => t.entryPoint)?.entryPoint ?? "";
    q.rubric = arr(o.rubric).map((c) => {
      const co = obj(c);
      return {
        key: newKey(),
        title: str(co.title) || str(co.criterion) || (typeof c === "string" ? c : "Criterion"),
        description: str(co.description),
        maxPoints:
          typeof co.maxPoints === "number"
            ? co.maxPoints
            : typeof co.points === "number"
              ? co.points
              : 1,
      };
    });
    if (qi === 0) q.scaffold = scaffold;
    const ladder = arr(o.hintLadder).filter((h): h is string => typeof h === "string");
    if (qi === 0 && ladder.length) {
      next.policy = {
        ...next.policy,
        hintLadder: ladder.slice(0, 6).map((g, level) => ({ level, guidance: g })),
      };
    }
    return q;
  });
  if (qs.length) next.questions = qs;
  return next;
}
