import type { AssignmentDraftModelOutput, WrittenGradeSuggestion } from "../schemas";
import type { AiRequestEnvelope } from "../types";
import { codeLine, detectTopics, firstSentence, parseError, pick, type TopicKey } from "./mock-util";

/** Deterministic mock behavior for PRACTICE, POST_ASSESSMENT_REVIEW, FACULTY_AUTHORING and FACULTY_ANALYTICS. */

// ---------------------------------------------------------------------------
// PRACTICE: direct explanations
// ---------------------------------------------------------------------------

const PRACTICE_EXPLANATIONS: Record<TopicKey, { explain: string; example: string; next: string }> = {
  recursion: {
    explain:
      "Recursion solves a problem by solving a smaller copy of the same problem. Every recursive function needs a base case that returns directly, and a recursive case that calls the function on a smaller input and combines the result.",
    example:
      "```python\ndef sum_to(n):\n    if n == 0:          # base case\n        return 0\n    return n + sum_to(n - 1)  # smaller input, combine\n```\nFor sum_to(3) the calls are sum_to(3) -> sum_to(2) -> sum_to(1) -> sum_to(0), which returns 0, and the results add up on the way back: 1, 3, 6.",
    next: "Next, try writing a recursive function that counts the digits of a non-negative integer.",
  },
  "linked-lists": {
    explain:
      "A linked list is a chain of nodes where each node stores a value and a reference to the next node. You walk it by following `next` until you reach None.",
    example:
      "```python\ndef length(head):\n    count = 0\n    current = head\n    while current is not None:\n        count += 1\n        current = current.next\n    return count\n```",
    next: "Next, try returning the last value in a linked list, handling the empty list.",
  },
  trees: {
    explain:
      "Binary tree functions usually follow one pattern: handle the empty tree, then combine the answers from the left and right subtrees with the current node.",
    example:
      "```python\ndef size(node):\n    if node is None:\n        return 0\n    return 1 + size(node.left) + size(node.right)\n```",
    next: "Next, try computing the height of a binary tree with the same pattern.",
  },
  lists: {
    explain:
      "Lists are indexed from 0 to len(lst) - 1. Looping with `for i in range(len(lst))` visits every valid index; `lst[len(lst)]` is always out of range.",
    example: "```python\ndef largest(lst):\n    best = lst[0]\n    for x in lst[1:]:\n        if x > best:\n            best = x\n    return best\n```",
    next: "Next, try returning the index of the largest element instead of its value.",
  },
  loops: {
    explain:
      "A loop needs a start, a condition that keeps it running, and an update that moves it toward stopping. Tracing the loop variable on paper is the fastest way to find off-by-one errors.",
    example: "```python\ntotal = 0\nfor i in range(1, 4):   # i = 1, 2, 3\n    total += i\n# total == 6\n```",
    next: "Next, try a while loop that halves a number until it is below 1, counting the steps.",
  },
  strings: {
    explain: "Strings are immutable sequences of characters. You can index, slice and loop over them; to build a new string, collect pieces and join them.",
    example: "```python\ndef reverse(s):\n    return s[::-1]\n\nreverse(\"abc\")  # \"cba\"\n```",
    next: "Next, try checking whether a string is a palindrome without using slicing.",
  },
  complexity: {
    explain:
      "Big-O describes how the number of steps grows with input size n. A single pass over a list is O(n); a loop nested inside another loop over the same list is O(n^2); halving the input each step is O(log n).",
    example: "```python\nfor i in range(n):        # n iterations\n    for j in range(n):    # n iterations each\n        work()            # runs n * n times -> O(n^2)\n```",
    next: "Next, work out the complexity of binary search and explain why.",
  },
  functions: {
    explain: "A function receives inputs as parameters and returns a result with `return`. `print` only displays a value; the caller cannot use it.",
    example: "```python\ndef square(x):\n    return x * x\n\ny = square(4)  # y == 16\n```",
    next: "Next, try writing a function that returns both the minimum and maximum of a list.",
  },
};

export function mockPractice(env: AiRequestEnvelope, rng: () => number): string {
  const topics = detectTopics(env.userMessage, env.assignment?.prompt, env.assignment?.topicTags.join(" "), env.workspace?.code);
  const topic = topics[0]!;
  const e = PRACTICE_EXPLANATIONS[topic];
  const parts: string[] = [];
  const err = parseError(env.latestExecution);
  if (err.kind !== "none") {
    const line = codeLine(env.workspace?.code ?? "", err.line);
    parts.push(
      `Your run reported "${err.message}"${err.line ? ` on line ${err.line}${line ? ` (\`${line.trim()}\`)` : ""}` : ""}. ${
        err.kind === "syntax"
          ? "That is a syntax problem: check that line and the one before it for a missing colon, bracket or quote."
          : "That happens at run time, so trace the values on that line for the input that failed."
      }`,
    );
  }
  parts.push(pick(rng, ["Here is the idea.", "Let's go through it directly."]) + " " + e.explain);
  parts.push(e.example);
  const weak = env.learnerContext?.topicStates.find((t) => t.state === "NEEDS_REINFORCEMENT");
  parts.push(weak ? `${e.next} Since ${weak.topic} is marked as needing reinforcement, a follow-up on it would help too.` : e.next);
  const r = env.retrievedResources[0];
  if (r) parts.push(`For more, see the course resource "${r.title}".`);
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// POST_ASSESSMENT_REVIEW: line-by-line explanation of the released solution
// ---------------------------------------------------------------------------

export function explainLine(line: string, fnName: string | null): string | null {
  const t = line.trim();
  if (!t || /^[})\]];?$/.test(t)) return null;
  if (/^(#|\/\/)/.test(t)) return `A comment: ${t.replace(/^(#|\/\/)\s*/, "")}.`;
  let m: RegExpExecArray | null;
  if ((m = /^def\s+(\w+)\s*\((.*?)\)/.exec(t)) || (m = /^function\s+(\w+)\s*\((.*?)\)/.exec(t))) {
    return `Defines \`${m[1]}\`${m[2] ? ` with parameter${m[2].includes(",") ? "s" : ""} \`${m[2]}\`` : " with no parameters"}.`;
  }
  if ((m = /^(?:if|elif|else if|\}\s*else if)\s*\(?(.*?)\)?\s*[:{]?$/.exec(t))) {
    const cond = m[1] ?? "";
    const base = /<=\s*[01]\b|==\s*0\b|is None|=== null|== null|not\s+\w+|length === 0|len\(\w+\)\s*==\s*0/.test(cond);
    return `Checks \`${cond}\`.${base ? " This is the base case: it stops the recursion (or handles the empty input) before anything else runs." : ""}`;
  }
  if (/^else\b|^\}\s*else\s*\{/.test(t)) return "Otherwise (none of the conditions above held), the following block runs.";
  if ((m = /^return\s+(.*?);?$/.exec(t))) {
    const expr = m[1] ?? "";
    if (fnName && new RegExp(`\\b${fnName}\\s*\\(`).test(expr)) {
      return `Recursive case: returns \`${expr}\`, which calls \`${fnName}\` on a smaller input and combines its result.`;
    }
    return `Returns \`${expr}\` to the caller.`;
  }
  if ((m = /^for\s+(.*?)\s+in\s+(.*?):$/.exec(t))) return `Loops over \`${m[2]}\`, binding each item to \`${m[1]}\`.`;
  if ((m = /^for\s*\((.*)\)\s*\{?$/.exec(t))) return `Loops with \`${m[1]}\`.`;
  if ((m = /^while\s*\(?(.*?)\)?\s*[:{]?$/.exec(t))) return `Repeats while \`${m[1]}\` holds.`;
  if ((m = /^(?:const|let|var|val)?\s*([\w.[\]]+)\s*([+\-*/]?=)\s*(.+?);?$/.exec(t)) && !t.startsWith("==")) {
    return m[2] === "=" ? `Stores \`${m[3]}\` in \`${m[1]}\`.` : `Updates \`${m[1]}\` with \`${m[2]} ${m[3]}\`.`;
  }
  return `Runs \`${t}\`.`;
}

export function mockReview(env: AiRequestEnvelope): string {
  const solution = env.assignment?.referenceSolution;
  const student = env.workspace?.code ?? "";
  if (!solution) {
    return [
      "The reference solution has not been released for this assignment, so I can't walk through it yet.",
      student.trim()
        ? "I can still go through your submitted approach with you: tell me which part you want to understand better."
        : "Once your instructor releases solutions, ask again and I'll explain it line by line.",
    ].join(" ");
  }
  const fn = /^\s*(?:def|function)\s+(\w+)/m.exec(solution)?.[1] ?? null;
  const lines = solution.split("\n");
  const explained = lines
    .map((l, i) => {
      const e = explainLine(l, fn);
      return e ? `Line ${i + 1}: \`${l.trim()}\` - ${e}` : null;
    })
    .filter(Boolean);
  const lang = env.workspace?.language === "JAVASCRIPT" ? "javascript" : env.workspace?.language === "SCALA" ? "scala" : "python";
  const parts = [
    "This assignment is closed and the solution has been released, so here is the complete reference solution, explained line by line.",
    `\`\`\`${lang}\n${solution.trimEnd()}\n\`\`\``,
    explained.join("\n"),
  ];
  if (student.trim()) {
    const norm = (s: string) => s.replace(/\s+/g, "");
    const studentSet = new Set(student.split("\n").map(norm).filter(Boolean));
    const missing = lines.filter((l) => l.trim() && !studentSet.has(norm(l)) && explainLine(l, fn));
    parts.push(
      missing.length
        ? `Compared with your submission, these reference lines have no exact match in your code: ${missing
            .slice(0, 4)
            .map((l) => `\`${l.trim()}\``)
            .join(", ")}. Check whether your version does the same work another way.`
        : "Your submission contains every line of the reference solution, so your approach matches it.",
    );
  }
  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// FACULTY_AUTHORING: schema-valid assignment suggestion from topic keywords
// ---------------------------------------------------------------------------

interface Template {
  topicSlugs: string[];
  title: string;
  fn: string;
  params: string[];
  scalaSig: string;
  prompt: string;
  objectives: string[];
  tests: Array<[string, unknown[], unknown]>;
  hidden: Array<[string, string, unknown[], unknown]>;
  misconceptions: Array<[string, string]>;
  hints: string[];
}

const TEMPLATES: Record<TopicKey, Template> = {
  recursion: {
    topicSlugs: ["recursion", "recursive-base-cases", "call-stack-tracing"],
    title: "Recursive digit sum",
    fn: "digit_sum",
    params: ["n"],
    scalaSig: "def digitSum(n: Int): Int",
    prompt: "Write a recursive function `digit_sum(n)` that returns the sum of the decimal digits of a non-negative integer n. Do not use loops or string conversion.",
    objectives: ["Identify an appropriate base case for a recursive function", "Reduce a problem to a strictly smaller subproblem", "Trace the call stack of a recursive function"],
    tests: [["single digit", [7], 7], ["two digits", [42], 6], ["zero", [0], 0]],
    hidden: [["large number", "many digits", [987654321], 45], ["trailing zeros", "zeros contribute nothing", [1000], 1]],
    misconceptions: [["missing base case", "Recursion never stops for single-digit inputs"], ["input does not shrink", "Recursive call passes n instead of n // 10"], ["result not returned", "Recursive call result is computed but not returned"]],
    hints: [
      "What should digit_sum return for a single-digit number?",
      "How can you split n into its last digit and the rest of the number?",
      "Recall that n % 10 gives the last digit and n // 10 drops it.",
      "Check the line where you call digit_sum again: is the argument smaller?",
      "Compare with the factorial example from lecture: base case first, then combine.",
      "Return the last digit plus the digit sum of the remaining number.",
    ],
  },
  "linked-lists": {
    topicSlugs: ["linked-structures", "recursion"],
    title: "Count matching nodes in a linked list",
    fn: "count_matches",
    params: ["head", "target"],
    scalaSig: "def countMatches(head: Node, target: Int): Int",
    prompt: "A linked list node has fields `value` and `next` (None at the end). Write `count_matches(head, target)` that returns how many nodes hold `target`. The tests pass the list as a Python list of values that the harness converts to nodes.",
    objectives: ["Traverse a linked structure safely until its end", "Handle the empty list", "Choose between iterative and recursive traversal"],
    tests: [["empty list", [[], 3], 0], ["one match", [[1, 3, 5], 3], 1], ["all match", [[2, 2, 2], 2], 3]],
    hidden: [["no match long", "long list without the target", [[1, 2, 3, 4, 5, 6, 7, 8], 9], 0], ["match at tail", "target only in the last node", [[4, 4, 9], 9], 1]],
    misconceptions: [["dereferencing None", "Reads current.value after reaching the end"], ["skips head", "Starts counting at head.next"]],
    hints: [
      "What should the function return for an empty list?",
      "How do you move from one node to the next?",
      "A traversal stops when the current reference is None.",
      "Check the condition of your loop: do you look at the last node?",
      "The lecture's list-length example has the same traversal shape.",
      "Increment a counter whenever current.value equals target, then advance current.",
    ],
  },
  trees: {
    topicSlugs: ["trees", "traversal", "recursion"],
    title: "Height of a binary tree",
    fn: "height",
    params: ["root"],
    scalaSig: "def height(root: Tree): Int",
    prompt: "Write `height(root)` returning the number of nodes on the longest root-to-leaf path of a binary tree (empty tree: 0). Trees are given as nested lists [value, left, right] with None for empty.",
    objectives: ["Define a recursive function over a recursive data structure", "Combine results from subtrees", "Reason about the empty-tree base case"],
    tests: [["empty", [null], 0], ["single node", [[1, null, null]], 1], ["left chain", [[1, [2, [3, null, null], null], null]], 3]],
    hidden: [["balanced", "full tree of depth 3", [[1, [2, [4, null, null], [5, null, null]], [3, [6, null, null], [7, null, null]]]], 3]],
    misconceptions: [["off-by-one height", "Counts edges instead of nodes"], ["only follows one subtree", "Ignores the right subtree"]],
    hints: [
      "What is the height of an empty tree?",
      "How does a tree's height relate to its subtrees' heights?",
      "Each call should handle one node and trust the recursive calls on its children.",
      "Check that both subtrees are considered.",
      "See the traversal notes for the shape of recursive tree functions.",
      "Take the larger of the two subtree heights and add one for the current node.",
    ],
  },
  lists: {
    topicSlugs: ["lists", "control-flow"],
    title: "Running maximum",
    fn: "running_max",
    params: ["values"],
    scalaSig: "def runningMax(values: List[Int]): List[Int]",
    prompt: "Write `running_max(values)` that returns a new list where position i holds the largest value among values[0..i]. Return [] for an empty list.",
    objectives: ["Iterate over a list while maintaining state", "Build a new list without mutating the input", "Handle empty input"],
    tests: [["empty", [[]], []], ["increasing", [[1, 2, 3]], [1, 2, 3]], ["mixed", [[3, 1, 4, 1, 5]], [3, 3, 4, 4, 5]]],
    hidden: [["negatives", "all negative values", [[-5, -9, -2]], [-5, -5, -2]]],
    misconceptions: [["initial max of zero", "Starts the maximum at 0, wrong for negative inputs"], ["off-by-one indexing", "Loop skips the first or last element"]],
    hints: [
      "What should the first element of the result be?",
      "What do you need to remember as you move through the list?",
      "Keep the largest value seen so far in a variable.",
      "Check how you initialize that variable.",
      "Revisit the list-iteration examples from lecture.",
      "Start the maximum at the first value, not at 0, and append it at every step.",
    ],
  },
  loops: {
    topicSlugs: ["control-flow", "variables"],
    title: "Collatz steps",
    fn: "collatz_steps",
    params: ["n"],
    scalaSig: "def collatzSteps(n: Int): Int",
    prompt: "Write `collatz_steps(n)` returning how many steps it takes to reach 1 from a positive integer n, where each step halves an even n or maps an odd n to 3n + 1.",
    objectives: ["Write a while loop with a correct stopping condition", "Use conditionals inside a loop", "Count iterations accurately"],
    tests: [["already one", [1], 0], ["two", [2], 1], ["six", [6], 8]],
    hidden: [["twenty-seven", "long sequence", [27], 111]],
    misconceptions: [["off-by-one count", "Counts the starting value as a step"], ["wrong loop condition", "Stops before reaching 1"]],
    hints: [
      "How many steps does it take when n is already 1?",
      "What changes in each iteration?",
      "A while loop runs until its condition becomes false.",
      "Check where you increment the step counter.",
      "The loop examples in the notes show the start/condition/update pattern.",
      "Loop while n is not 1, update n by the rule, and count each update.",
    ],
  },
  strings: {
    topicSlugs: ["strings", "control-flow"],
    title: "Compress repeated characters",
    fn: "compress",
    params: ["s"],
    scalaSig: "def compress(s: String): String",
    prompt: "Write `compress(s)` that replaces each run of a repeated character with the character followed by the run length, e.g. \"aaab\" -> \"a3b1\".",
    objectives: ["Iterate over characters while tracking runs", "Build a result string", "Handle the final run and empty input"],
    tests: [["empty", [""], ""], ["no repeats", ["abc"], "a1b1c1"], ["runs", ["aaab"], "a3b1"]],
    hidden: [["single long run", "one character repeated", ["zzzzzz"], "z6"]],
    misconceptions: [["forgets last run", "Final run is never appended"], ["string mutation", "Tries to modify a string in place"]],
    hints: [
      "What should compress return for an empty string?",
      "What do you need to remember while scanning the characters?",
      "Track the current character and how many times it has repeated.",
      "Check what happens after the loop ends.",
      "See the string-processing examples from lecture.",
      "When the character changes, append the previous character and its count; do it once more after the loop.",
    ],
  },
  complexity: {
    topicSlugs: ["asymptotic-complexity", "lists"],
    title: "Detect duplicates efficiently",
    fn: "has_duplicates",
    params: ["values"],
    scalaSig: "def hasDuplicates(values: List[Int]): Boolean",
    prompt: "Write `has_duplicates(values)` that returns True if any value appears twice. Then explain the time complexity of your approach in a comment.",
    objectives: ["Compare O(n^2) and O(n) approaches", "Use a set for membership tests", "Justify a complexity claim"],
    tests: [["empty", [[]], false], ["no duplicates", [[1, 2, 3]], false], ["duplicate", [[1, 2, 1]], true]],
    hidden: [["large unique", "many distinct values", [[10, 20, 30, 40, 50, 60]], false]],
    misconceptions: [["confuses nested loops with linear time", "Claims a nested loop is O(n)"]],
    hints: [
      "How would you check by hand whether a list has a repeated value?",
      "How many comparisons does comparing every pair take?",
      "A set can answer 'have I seen this?' in about constant time.",
      "Check where your code does its membership test.",
      "The complexity notes compare nested loops with hashing.",
      "Track values you've seen in a set and stop as soon as one repeats.",
    ],
  },
  functions: {
    topicSlugs: ["functions", "variables"],
    title: "Temperature conversion",
    fn: "to_fahrenheit",
    params: ["celsius"],
    scalaSig: "def toFahrenheit(celsius: Double): Double",
    prompt: "Write `to_fahrenheit(celsius)` that returns the Fahrenheit equivalent (F = C * 9/5 + 32).",
    objectives: ["Define a function with a parameter", "Return (not print) a computed value", "Test a function with sample inputs"],
    tests: [["freezing", [0], 32], ["boiling", [100], 212], ["negative forty", [-40], -40]],
    hidden: [["body temperature", "fractional result", [37], 98.6]],
    misconceptions: [["print instead of return", "Prints the result instead of returning it"], ["operator precedence", "Adds 32 before multiplying"]],
    hints: [
      "What should the function give back to the caller?",
      "Which operation in the formula happens first?",
      "Return sends a value back; print only displays it.",
      "Check the order of operations in your expression.",
      "See the functions section of the course notes.",
      "Multiply by 9/5 first, then add 32, and return the result.",
    ],
  },
};

function starterCode(t: Template, language: string): string {
  if (language === "JAVASCRIPT") {
    const fn = t.fn.replace(/_(\w)/g, (_m, c: string) => c.toUpperCase());
    return `function ${fn}(${t.params.join(", ")}) {\n  // TODO: implement\n}\n\nmodule.exports = { ${fn} };\n`;
  }
  if (language === "SCALA") return `object Solution {\n  ${t.scalaSig} = {\n    // TODO: implement\n    ???\n  }\n}\n`;
  return `def ${t.fn}(${t.params.join(", ")}):\n    # TODO: implement\n    pass\n`;
}

export function mockAuthoring(env: AiRequestEnvelope): AssignmentDraftModelOutput {
  const input = (env.authoringInput ?? {}) as { prompt?: string; language?: string; format?: string; topics?: string[] };
  const prompt = input.prompt ?? env.userMessage ?? "";
  const topics = detectTopics(prompt, (input.topics ?? []).join(" "));
  const t = TEMPLATES[topics[0]!];
  const language = (input.language ?? "PYTHON").toUpperCase();
  const written = input.format === "WRITTEN";
  const total = 10;
  return {
    title: t.title,
    description: `${firstSentence(t.prompt, 300)} Generated from the request: "${prompt.slice(0, 160)}". Review and edit before publishing.`,
    learningObjectives: t.objectives,
    topicSlugs: [...new Set([...t.topicSlugs, ...topics.filter((k) => k !== "functions")])].slice(0, 6),
    questions: [
      {
        prompt: written ? `Explain, in your own words, how you would approach this problem and why: ${t.prompt}` : t.prompt,
        starterCode: written ? "" : starterCode(t, language),
        publicTests: written ? [] : t.tests.map(([name, args, expected]) => ({ name, argsJson: JSON.stringify(args), expectedJson: JSON.stringify(expected) })),
        hiddenTestSuggestions: written
          ? []
          : t.hidden.map(([name, description, args, expected]) => ({ name, description, argsJson: JSON.stringify(args), expectedJson: JSON.stringify(expected) })),
        rubric: [
          { criterion: "Correctness", description: "Passes public and hidden tests", points: total * 0.6 },
          { criterion: "Approach", description: `Uses ${topics[0]!.replace("-", " ")} appropriately`, points: total * 0.3 },
          { criterion: "Style", description: "Readable names and structure", points: total * 0.1 },
        ],
        hintLadder: t.hints.map((guidance, level) => ({ level, guidance })),
        predictedMisconceptions: t.misconceptions.map(([label, description]) => ({ label, description })),
      },
    ],
    scaffold: [
      { stage: "PREDICT", instructions: `Before coding, predict what ${t.fn} returns for each public test input.` },
      { stage: "TRACE", instructions: "Trace your code by hand on the smallest test input, writing variable values at each step." },
      { stage: "COUNTEREXAMPLE", instructions: "Find an input where a naive version would fail and explain why." },
      { stage: "REPAIR", instructions: "Fix the first failing public test, changing as little as possible." },
      { stage: "EXPLAIN", instructions: "Explain in two sentences why your solution is correct." },
      { stage: "REFLECT", instructions: "Which hint level did you need, and what would you do differently next time?" },
    ],
  };
}

// ---------------------------------------------------------------------------
// Grading suggestion (written answers)
// ---------------------------------------------------------------------------

const STOP = new Set("the and that with this from have will your their there which about into when what then than they them been were also only each more most such some very".split(" "));

export function mockGrading(env: AiRequestEnvelope): WrittenGradeSuggestion {
  const input = (env.authoringInput ?? {}) as {
    answer?: string;
    maxPoints?: number;
    rubric?: Array<{ title: string; description: string; maxPoints: number }>;
    answerKey?: unknown;
  };
  const answer = input.answer ?? "";
  const maxPoints = input.maxPoints ?? (input.rubric ?? []).reduce((s, c) => s + c.maxPoints, 0);
  const keyText = [...(input.rubric ?? []).map((c) => `${c.title} ${c.description}`), typeof input.answerKey === "string" ? input.answerKey : JSON.stringify(input.answerKey ?? "")].join(" ");
  const keywords = [...new Set((keyText.toLowerCase().match(/[a-z]{5,}/g) ?? []).filter((w) => !STOP.has(w)))];
  const answerLower = answer.toLowerCase();
  const matched = keywords.filter((k) => answerLower.includes(k));
  const coverage = keywords.length ? matched.length / keywords.length : answer.trim() ? 0.5 : 0;
  const suggested = answer.trim() ? Math.round(maxPoints * Math.min(1, coverage * 1.25) * 2) / 2 : 0;
  const sentences = answer.split(/(?<=[.!?])\s+/).filter((s) => matched.some((k) => s.toLowerCase().includes(k)));
  return {
    suggestedPoints: Math.min(suggested, maxPoints),
    maxPoints,
    rationale: answer.trim()
      ? `The answer addresses ${matched.length} of ${keywords.length} rubric terms (${matched.slice(0, 6).join(", ") || "none"}).`
      : "No answer was submitted.",
    evidence: sentences.slice(0, 4).map((s) => s.slice(0, 240)),
    feedback: answer.trim()
      ? matched.length < keywords.length
        ? `Good start. Consider also addressing: ${keywords.filter((k) => !matched.includes(k)).slice(0, 4).join(", ")}.`
        : "The answer covers the rubric's key ideas clearly."
      : "Please submit an answer.",
    confidence: keywords.length >= 4 ? 0.6 : 0.4,
  };
}

// ---------------------------------------------------------------------------
// FACULTY_ANALYTICS: summarize only the numbers given
// ---------------------------------------------------------------------------

interface MetricLike {
  numerator: number;
  denominator: number;
  value: number | null;
  suppressed: boolean;
}

function isMetric(v: unknown): v is MetricLike {
  return !!v && typeof v === "object" && "numerator" in v && "denominator" in v && "suppressed" in v;
}

function humanize(path: string[]): string {
  const raw = path.filter((p) => !/^\d+$/.test(p)).slice(-2).join(" ");
  return raw.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " ").toLowerCase();
}

export function mockAnalyticsBrief(env: AiRequestEnvelope): string {
  const payload = env.analyticsPayload ?? {};
  const facts: string[] = [];
  const insufficient: string[] = [];
  let weakest: { label: string; value: number } | null = null;
  const walk = (v: unknown, path: string[], label: string | null) => {
    if (facts.length >= 6) return;
    if (isMetric(v)) {
      const name = label ? `${label} ${humanize(path.slice(-1))}` : humanize(path);
      if (v.suppressed || v.value === null) insufficient.push(name);
      else {
        facts.push(`${name}: ${v.numerator} of ${v.denominator}.`);
        if (label && (weakest === null || v.value < weakest.value)) weakest = { label, value: v.value };
      }
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, String(i)], label));
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const own = typeof o.name === "string" ? o.name : typeof o.title === "string" ? o.title : typeof o.label === "string" ? o.label : label;
      for (const [k, x] of Object.entries(o)) walk(x, [...path, k], own);
    }
  };
  walk(payload, [], null);
  const lines: string[] = [];
  if (facts.length) lines.push(`This week's computed metrics: ${facts.join(" ")}`);
  else lines.push("No metrics with enough data were available this week.");
  if (insufficient.length) lines.push(`Insufficient data for: ${insufficient.slice(0, 4).join(", ")}.`);
  const w = weakest as { label: string; value: number } | null;
  if (w) lines.push(`"${w.label}" has the lowest reported rate among the listed items; consider a short in-class review or targeted practice on it.`);
  return lines.join("\n\n");
}

// ---------------------------------------------------------------------------
// PRACTICE structured tasks (used by the practice domain via runAi): item generation and free-response grading
// ---------------------------------------------------------------------------

interface MockPracticeItem {
  type: "MULTIPLE_CHOICE" | "SHORT_ANSWER" | "TRACE" | "EXPLAIN";
  prompt: string;
  starterCode: string | null;
  choices: Array<{ id: string; text: string; correct: boolean }> | null;
  answer: string;
  explanation: string;
}

const mc = (prompt: string, options: string[], correctIdx: number, explanation: string): MockPracticeItem => ({
  type: "MULTIPLE_CHOICE",
  prompt,
  starterCode: null,
  choices: options.map((text, i) => ({ id: "ABCD"[i]!, text, correct: i === correctIdx })),
  answer: "ABCD"[correctIdx]!,
  explanation,
});

const PRACTICE_BANK: Record<TopicKey, MockPracticeItem[]> = {
  recursion: [
    mc("What does `f(3)` return?\n```python\ndef f(n):\n    if n == 0:\n        return 0\n    return n + f(n - 1)\n```", ["3", "6", "0", "It never returns"], 1, "f(3) = 3 + f(2) = 3 + 2 + f(1) = 3 + 2 + 1 + f(0) = 6."),
    mc("Which change makes this function stop for every non-negative n?\n```python\ndef g(n):\n    return g(n - 1) + 1\n```", ["Add `if n == 0: return 0` before the return", "Change `n - 1` to `n + 1`", "Remove the `+ 1`", "Call g(n) instead"], 0, "Without a base case the recursion never stops; checking n == 0 first stops it."),
    { type: "TRACE", prompt: "What does this print?\n```python\ndef h(n):\n    if n <= 1:\n        return 1\n    return n * h(n - 1)\nprint(h(4))\n```", starterCode: null, choices: null, answer: "24", explanation: "h(4) = 4 * 3 * 2 * h(1) = 24." },
  ],
  "linked-lists": [
    mc("A loop does `current = current.next` until `current is None`. How many times does the body run for a 3-node list?", ["2", "3", "4", "It depends on the values"], 1, "It visits each node once: 3 iterations."),
    mc("What happens if you read `current.value` after `current` becomes None?", ["It returns 0", "An AttributeError/TypeError", "It returns None", "The loop restarts"], 1, "None has no fields, so reading one raises an error."),
  ],
  trees: [
    mc("What is the height (in nodes) of a tree with only a root?", ["0", "1", "2", "Undefined"], 1, "A single node is a path of one node."),
    mc("In-order traversal of a BST visits keys in which order?", ["Insertion order", "Sorted order", "Reverse sorted order", "Level by level"], 1, "Left subtree, node, right subtree yields sorted keys in a BST."),
  ],
  lists: [
    mc("For `lst = [4, 8, 15]`, which index raises an IndexError?", ["0", "2", "3", "-1"], 2, "Valid indices are 0..2 (and negative -1..-3); index 3 is out of range."),
    { type: "SHORT_ANSWER", prompt: "What is `len([1, [2, 3], 4])`?", starterCode: null, choices: null, answer: "3", explanation: "The nested list counts as one element." },
  ],
  loops: [
    { type: "TRACE", prompt: "What does this print?\n```python\ntotal = 0\nfor i in range(1, 5):\n    total += i\nprint(total)\n```", starterCode: null, choices: null, answer: "10", explanation: "range(1, 5) is 1, 2, 3, 4; their sum is 10." },
    mc("How many times does `while n > 0: n -= 2` run when n starts at 5?", ["2", "3", "5", "It never stops"], 1, "n goes 5 -> 3 -> 1 -> -1: three iterations."),
  ],
  strings: [
    { type: "SHORT_ANSWER", prompt: "What is `\"socra\"[1:3]`?", starterCode: null, choices: null, answer: "oc||\"oc\"", explanation: "Slicing takes indices 1 and 2: 'o' and 'c'." },
    mc("Strings in Python are...", ["mutable", "immutable", "always ASCII", "lists"], 1, "You cannot change a string in place; operations create new strings."),
  ],
  complexity: [
    mc("What is the time complexity of a loop over n items nested inside another loop over n items?", ["O(n)", "O(log n)", "O(n^2)", "O(1)"], 2, "The inner body runs n times for each of n outer iterations."),
    mc("Binary search on a sorted list of n items takes...", ["O(n)", "O(log n)", "O(n log n)", "O(1)"], 1, "Each step halves the remaining range."),
  ],
  functions: [
    mc("What does a function return if it reaches the end without a return statement in Python?", ["0", "None", "An error", "The last value computed"], 1, "Python returns None implicitly."),
    { type: "SHORT_ANSWER", prompt: "What value does `y` hold?\n```python\ndef sq(x):\n    return x * x\ny = sq(3) + 1\n```", starterCode: null, choices: null, answer: "10", explanation: "sq(3) is 9; plus 1 gives 10." },
  ],
};

export function mockPracticeItem(env: AiRequestEnvelope, rng: () => number): MockPracticeItem {
  const input = (env.authoringInput ?? {}) as { topic?: string; difficulty?: number };
  const topic = detectTopics(input.topic, env.userMessage.split("\n")[0])[0]!;
  const bank = PRACTICE_BANK[topic];
  const fresh = bank.filter((i) => !env.userMessage.includes(i.prompt.slice(0, 40)));
  const pool = fresh.length ? fresh : bank;
  return pool[Math.floor(rng() * pool.length) % pool.length]!;
}

function section(text: string, header: string): string | null {
  const re = new RegExp(`${header}:\n([\s\S]*?)(?:\n\n[A-Z][\w' ]*:\n|$)`);
  return re.exec(text)?.[1]?.trim() ?? null;
}

export function mockPracticeGrade(env: AiRequestEnvelope): { correct: boolean; score: number; feedback: string } {
  const model = section(env.userMessage, "Model answer");
  const student = section(env.userMessage, "Student answer") ?? "";
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!model) {
    return { correct: false, score: 0.5, feedback: "No reference answer was available, so this answer needs review." };
  }
  const alternatives = model.split("||").map(norm).filter(Boolean);
  const s = norm(student);
  if (alternatives.includes(s)) return { correct: true, score: 1, feedback: "Correct." };
  const words = new Set(alternatives.flatMap((a) => a.split(" ")));
  const hit = s.split(" ").filter((w) => words.has(w)).length;
  const score = words.size ? Math.min(1, hit / words.size) : 0;
  return score >= 0.7
    ? { correct: true, score: Math.round(score * 100) / 100, feedback: "Correct in substance; compare your wording with the reference answer." }
    : { correct: false, score: Math.round(score * 100) / 100, feedback: `Not quite. The expected answer is: ${model.split("||")[0]!.trim()}.` };
}
