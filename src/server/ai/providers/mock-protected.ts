import type { ProtectedTurn } from "../schemas";
import type { AiRequestEnvelope, InterventionLevel, RetrievedResource } from "../types";
import {
  ANSWER_SEEKING,
  CONCEPT_QUESTION,
  START_HELP,
  codeLine,
  conditionLines,
  detectTopics,
  firstSentence,
  mainFunctionName,
  parseError,
  pick,
  priorUserTurns,
  recursiveCallLines,
  returnLines,
  type ParsedError,
  type TopicKey,
} from "./mock-util";

/**
 * Deterministic PROTECTED_ASSESSMENT tutor. Reads the real workspace code, latest run error and failing public tests
 * from the envelope; picks an intervention level from conversation depth and request type; quotes the actual error
 * and real line numbers; cites a retrieved resource when present. Never writes the target function.
 */

const CONCEPTS: Record<TopicKey, string> = {
  recursion:
    "A recursive function needs two things: a base case that returns without calling itself, and a recursive case that calls itself on a strictly smaller input so it eventually reaches the base case.",
  "linked-lists":
    "With linked structures, every step either looks at the current node or follows `.next`. The end of the list is reached when the reference is None/null, so that check has to happen before you read a field.",
  trees:
    "Tree functions usually handle the empty tree (None/null) first, then combine the results from the left and right subtrees. Each call works on one node and trusts the recursive calls for its children.",
  lists:
    "When you index into a list, valid positions run from 0 to len - 1. Off-by-one mistakes usually come from a loop bound or an index that reaches len.",
  loops:
    "A loop is correct when three things line up: where it starts, the condition that keeps it going, and the update that moves it toward stopping.",
  strings:
    "Strings behave like sequences of characters: you can index, slice and loop over them, but they are immutable, so building a result means creating a new string.",
  complexity:
    "To estimate running time, count how many times the most frequent operation runs as the input size n grows, ignoring constant factors.",
  functions:
    "A function takes its inputs as parameters and hands its result back with `return`. Printing a value is not the same as returning it.",
};

const ANALOGIES: Record<TopicKey, string> = {
  recursion:
    "Here is a different function with the same shape:\n```python\ndef countdown(k):\n    if k == 0:\n        return\n    countdown(k - 1)\n```\nWhich line is the base case, and what makes each call smaller?",
  "linked-lists":
    "Consider counting nodes: you start at the head, and each step moves `current = current.next` until `current` is None. Where in your code do you move to the next node, and what happens at the last one?",
  trees:
    "Think about counting the leaves of a tree: an empty tree has 0 leaves, a single node has 1, and otherwise the answer comes from the two subtrees. Which of these cases does your function handle?",
  lists:
    "Try tracing a 3-element list by hand: write the index and value on each iteration. At which index does your code stop, and is that the last valid one?",
  loops:
    "Try writing the loop variable's value on paper for each iteration with a tiny input. Does the loop run one time too many or one time too few?",
  strings:
    "Take the string \"abc\" and trace your code by hand, writing the value of each variable after every step.",
  complexity:
    "Compare a single loop over n items (about n steps) with a loop inside another loop (about n times n steps). Which pattern does your code follow?",
  functions:
    "Try calling your function with the smallest input from the prompt and write down, line by line, what each variable holds.",
};

const MISCONCEPTIONS: Record<string, string> = {
  RecursionError: "missing or unreachable base case",
  "Maximum call stack": "missing or unreachable base case",
  StackOverflowError: "missing or unreachable base case",
  IndexError: "off-by-one indexing",
  "out of range": "off-by-one indexing",
  NoneType: "missing return value",
  undefined: "missing return value",
  AttributeError: "dereferencing None/null node",
  TypeError: "type mismatch between values",
  NameError: "using a name before it is defined",
  ReferenceError: "using a name before it is defined",
};

function misconceptionsFor(err: ParsedError, code: string, fn: string | null, topics: TopicKey[]): ProtectedTurn["misconceptionCandidates"] {
  const out: ProtectedTurn["misconceptionCandidates"] = [];
  for (const [needle, label] of Object.entries(MISCONCEPTIONS)) {
    if (err.message.includes(needle) && !out.some((m) => m.label === label)) {
      out.push({ label, confidence: label.includes("base case") ? 0.8 : 0.65 });
    }
  }
  if (fn && topics.includes("recursion")) {
    const calls = recursiveCallLines(code, fn);
    const lines = code.split("\n");
    const callNotReturned = calls.some((n) => !/return/.test(lines[n - 1] ?? "") && !/=/.test(lines[n - 1] ?? ""));
    if (calls.length && callNotReturned) out.push({ label: "recursive result not returned", confidence: 0.6 });
    const sameArg = calls.some((n) => new RegExp(`${fn}\\s*\\(\\s*\\w+\\s*\\)`).test(lines[n - 1] ?? "") && !/[-+/]|\[/.test((lines[n - 1] ?? "").split(fn)[1] ?? ""));
    if (sameArg) out.push({ label: "recursive call does not shrink the input", confidence: 0.55 });
  }
  return out.slice(0, 3);
}

function citation(resources: RetrievedResource[]): { text: string; ids: string[] } {
  const r = resources[0];
  if (!r) return { text: "", ids: [] };
  return { text: ` The course resource "${r.title}" covers this: ${firstSentence(r.excerpt, 180)}`, ids: [r.resourceId] };
}

function failingTests(env: AiRequestEnvelope) {
  return (env.latestExecution?.publicTests ?? []).filter((t) => !t.passed);
}

function quoteLine(code: string, n: number | null): string {
  const l = codeLine(code, n);
  return l && l.trim() ? `line ${n} (\`${l.trim()}\`)` : `line ${n}`;
}

/** Mechanical syntax help (allowed to be direct): the exact error, the line, and the one-line fix when obvious. */
function syntaxHelp(env: AiRequestEnvelope, err: ParsedError, rng: () => number): string {
  const code = env.workspace?.code ?? "";
  const lang = env.workspace?.language ?? "PYTHON";
  const candidates = [err.line, err.line ? err.line - 1 : null].filter((n): n is number => !!n && n > 0);
  const where = err.line ? ` on line ${err.line}` : "";
  const intro = pick(rng, [
    `This one is a syntax issue, so I can be direct. The ${lang === "SCALA" ? "compiler" : "interpreter"} reports${where}: "${err.message}".`,
    `Your last run stopped before executing anything because of a syntax error${where}: "${err.message}".`,
  ]);
  if (lang === "PYTHON") {
    for (const n of candidates) {
      const l = codeLine(code, n);
      if (l && /^\s*(def|if|elif|else|for|while|class|try|except|finally|with)\b/.test(l) && !/:\s*(#.*)?$/.test(l)) {
        return `${intro} Line ${n} starts a block (\`${l.trim()}\`), and Python block headers must end with a colon. Change it to:\n\`\`\`python\n${l.replace(/\s*$/, "")}:\n\`\`\`\nThen run again and check whether the tests change.`;
      }
    }
  }
  for (const n of candidates) {
    const l = codeLine(code, n);
    if (!l) continue;
    const opens = (l.match(/[([{]/g) ?? []).length;
    const closes = (l.match(/[)\]}]/g) ?? []).length;
    if (opens !== closes) {
      return `${intro} Line ${n} (\`${l.trim()}\`) has ${opens} opening and ${closes} closing brackets. Add the missing ${opens > closes ? "closing" : "opening"} bracket so they balance, then run again.`;
    }
    if ((l.match(/"/g) ?? []).length % 2 === 1 || (l.match(/'/g) ?? []).length % 2 === 1) {
      return `${intro} Line ${n} (\`${l.trim()}\`) has a string that is opened but never closed. Close the quote, then run again.`;
    }
  }
  if (/IndentationError|unindent|expected an indented block/.test(err.message)) {
    return `${intro} Python uses indentation to group statements. Make sure the body under the line before ${err.line ?? "the reported line"} is indented by the same number of spaces (4 is the convention), and that you are not mixing tabs and spaces.`;
  }
  return `${intro} The reported line is where the parser got confused, so check ${err.line ? quoteLine(code, err.line) : "that line"} and the line just before it for a missing colon, bracket, comma or quote.`;
}

export function mockProtectedTurn(env: AiRequestEnvelope, rng: () => number): ProtectedTurn {
  const msg = env.userMessage ?? "";
  const code = env.workspace?.code ?? "";
  const starter = env.assignment?.starterCode ?? "";
  const priors = priorUserTurns(env);
  const depth = priors.length;
  const maxLevel = (env.policy?.maxInterventionLevel ?? 5) as InterventionLevel;
  const err = parseError(env.latestExecution);
  const failing = failingTests(env);
  const topics = detectTopics(env.assignment?.topicTags.join(" "), env.assignment?.prompt, msg, code);
  const topic = topics[0]!;
  const fn = mainFunctionName(code) ?? mainFunctionName(starter);
  const cite = citation(env.retrievedResources);
  const misconceptions = misconceptionsFor(err, code, fn, topics);
  const clamp = (l: number): InterventionLevel => Math.min(l, maxLevel) as InterventionLevel;
  const out = (reply: string, level: InterventionLevel, withCitation = true): ProtectedTurn => ({
    reply: withCitation && cite.text && !reply.includes(cite.text.trim()) ? `${reply}${cite.text}` : reply,
    interventionLevel: level,
    citedResourceIds: withCitation ? cite.ids : [],
    misconceptionCandidates: misconceptions,
  });

  // UNRESTRICTED_AI research condition: direct help (logged under its own policy version by the service).
  if (env.researchCondition === "UNRESTRICTED_AI") {
    const detail = err.kind !== "none" ? ` The error "${err.message}"${err.line ? ` points at ${quoteLine(code, err.line)}` : ""}.` : "";
    return out(
      `Direct help (unrestricted condition):${detail} ${CONCEPTS[topic]} Apply that to ${fn ? `\`${fn}\`` : "your function"}, run the public tests, and compare each failing case's expected and actual values.`,
      5,
    );
  }

  // 1. Answer-seeking: refuse briefly and redirect with a Socratic question. Persistent attempts escalate (L6).
  if (ANSWER_SEEKING.test(msg)) {
    const attempts = priors.filter((p) => ANSWER_SEEKING.test(p)).length + 1;
    if (attempts >= 3 && depth >= 3) {
      return out(
        "I can't give you the solution while this assignment is open, and we've reached the point where more hints from me won't help much. This is a good moment to bring your current code and your question to your TA, office hours, or your instructor. Your work so far is saved.",
        6,
        false,
      );
    }
    const target = failing[0]
      ? `Your public test "${failing[0].name}" is failing${failing[0].message ? ` with "${failing[0].message}"` : ""}. What value do you expect for that input, and what does your code produce when you trace it?`
      : err.kind !== "none"
        ? `Your last run reported "${err.message}"${err.line ? ` at ${quoteLine(code, err.line)}` : ""}. What do you think that line is doing when the error happens?`
        : `What should ${fn ? `\`${fn}\`` : "your function"} return for the smallest input in the prompt, and does your current code do that?`;
    const decline = pick(rng, [
      "I can't write the answer for you while this assignment is open, but I can help you get there.",
      "Giving you the solution would skip the part this assignment is assessing, so I won't do that. Let's find the next step together.",
    ]);
    return out(`${decline} ${target}`, clamp(1), false);
  }

  // 2. Syntax / compile errors: mechanical help may be direct.
  if (err.kind === "syntax" && (env.policy?.allowDirectSyntaxHelp ?? true)) {
    return out(syntaxHelp(env, err, rng), clamp(3), false);
  }

  // 3. Orientation: nothing written yet or "where do I start".
  const untouched = !code.trim() || code.trim() === starter.trim();
  if (START_HELP.test(msg) || (untouched && depth === 0 && err.kind === "none" && failing.length === 0)) {
    const goal = env.assignment?.prompt ? firstSentence(env.assignment.prompt) : "the task in the prompt";
    return out(
      `Let's start by pinning down the goal: ${goal} Before writing code, what should ${fn ? `\`${fn}\`` : "your function"} return for the smallest possible input? Write that case down first, then think about how a slightly bigger input relates to it.`,
      0,
    );
  }

  // 4. Conceptual question with no specific failure: explain the concept (L2).
  if (CONCEPT_QUESTION.test(msg.trim()) && err.kind === "none" && failing.length === 0) {
    return out(`${CONCEPTS[topic]} How does that apply to ${fn ? `\`${fn}\`` : "your code"}?`, clamp(2));
  }

  // 5. Diagnostic ladder for runtime errors / failing tests / general "it doesn't work", deepening with each turn.
  const base = err.kind === "runtime" ? 2 : 1;
  const level = clamp(Math.min(base + depth, 5));
  const errText = err.kind === "runtime" ? `Your last run raised "${err.message}"${err.line ? ` at ${quoteLine(code, err.line)}` : ""}.` : "";
  const testText = failing[0]
    ? `Public test "${failing[0].name}" is failing${failing[0].message ? ` ("${failing[0].message}")` : ""}${failing.length > 1 ? `, along with ${failing.length - 1} other public test${failing.length > 2 ? "s" : ""}` : ""}.`
    : "";
  const observed = [errText, testText].filter(Boolean).join(" ") || "Let's check your current code against the prompt.";

  const recCalls = fn ? recursiveCallLines(code, fn) : [];
  const conds = conditionLines(code);
  const rets = returnLines(code);
  const suspicious =
    err.line ?? (topic === "recursion" ? (conds[0] ?? recCalls[0]) : undefined) ?? recCalls[0] ?? rets[rets.length - 1] ?? conds[0] ?? null;

  switch (level) {
    case 0:
    case 1:
      return out(
        `${observed} ${pick(rng, [
          `Pick the smallest input and trace your code by hand. What does each line produce, and where does that differ from what you expected?`,
          `What do you expect your code to return for that input, and what does it actually return when you trace it line by line?`,
        ])}`,
        level,
      );
    case 2:
      return out(`${observed} ${CONCEPTS[topic]} Which part of your code is responsible for that?`, level);
    case 3:
      return out(
        suspicious
          ? `${observed} Look closely at ${quoteLine(code, suspicious)}. What value does it work with on the call that fails, and is that what you intended?`
          : `${observed} Add a print of your key variables at the start of each step and compare the printed values with what you expect.`,
        level,
      );
    case 4:
      return out(
        cite.ids.length
          ? `${observed} This is a good point to revisit the course material on ${topic.replace("-", " ")}.${cite.text} Compare its pattern with your code${suspicious ? `, especially ${quoteLine(code, suspicious)}` : ""}.`
          : `${observed} ${ANALOGIES[topic]}`,
        level,
      );
    default: {
      const direction =
        topic === "recursion"
          ? `Make sure there is a base case that returns before any recursive call, and that the call${recCalls[0] ? ` on line ${recCalls[0]}` : ""} uses an input that is strictly closer to that base case.`
          : topic === "lists" || topic === "loops"
            ? `Check the loop bound or index${suspicious ? ` on line ${suspicious}` : ""}: it should stop at the last valid position, not one past it.`
            : topic === "linked-lists" || topic === "trees"
              ? `Handle the None/null case first${suspicious ? ` (before line ${suspicious})` : ""}, then work on the current node and move to the next one.`
              : `Focus on ${suspicious ? quoteLine(code, suspicious) : "the line that produces the result"}: the value it produces does not match the expected output for the failing test.`;
      return out(`${observed} Strong hint: ${direction} Make that one change yourself, then rerun the public tests.`, level);
    }
  }
}
