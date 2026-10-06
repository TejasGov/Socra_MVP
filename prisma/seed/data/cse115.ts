import { fnTest as f, pyRecursionTrace } from "./helpers";
import type { AssignmentDef, QuestionDef } from "./types";

const E = "count_down";

const hw3q1: QuestionDef = {
  key: "count-down",
  title: "count_down",
  difficulty: 3,
  points: 10,
  type: "CODING",
  language: "PYTHON",
  entryPoint: E,
  prompt: `## count_down(n)

Write a **recursive** function \`count_down(n)\` that returns a list of the integers from \`n\` down to \`1\`.

- \`count_down(3)\` returns \`[3, 2, 1]\`
- \`count_down(0)\` returns \`[]\`
- For any \`n\` that is zero or negative, return the empty list.

Do not use loops. Your function must stop for every integer input, not only positive ones.

Use **Run** to try your function with your own \`print\` calls, and **Run public tests** to check the visible tests. Hidden tests are used for grading.`,
  starterCode: String.raw`def count_down(n):
    """Return [n, n-1, ..., 1]. For n <= 0 return []."""
    # TODO: decide when the recursion must stop
    return [n] + count_down(n - 1)


print(count_down(3))
`,
  reference: String.raw`def count_down(n):
    """Return [n, n-1, ..., 1]. For n <= 0 return []."""
    if n <= 0:
        return []
    return [n] + count_down(n - 1)
`,
  tests: [
    f(
      "t1",
      "count_down(3)",
      "PUBLIC",
      1,
      E,
      [3],
      [3, 2, 1],
      "Trace count_down(3) by hand: which calls happen and what does each return?",
    ),
    f("t2", "count_down(1)", "PUBLIC", 1, E, [1], [1]),
    f(
      "t3",
      "count_down(0)",
      "PUBLIC",
      1,
      E,
      [0],
      [],
      "What should the function return when there is nothing left to count?",
    ),
    f("t4", "count_down(5)", "PUBLIC", 1, E, [5], [5, 4, 3, 2, 1]),
    f("h1", "count_down(-3) terminates", "HIDDEN", 2, E, [-3], []),
    f("h2", "count_down(10)", "HIDDEN", 1, E, [10], [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
    f("h3", "count_down(-1) terminates", "HIDDEN", 1, E, [-1], []),
    f(
      "h4",
      "count_down(25) length",
      "HIDDEN",
      1,
      E,
      [25],
      Array.from({ length: 25 }, (_, i) => 25 - i),
    ),
  ],
  variants: [
    {
      key: "starter",
      label: "Starter code (no base case)",
      code: String.raw`def count_down(n):
    # TODO
    return [n] + count_down(n - 1)
`,
      failing: ["t1", "t2", "t3", "t4", "h1", "h2", "h3", "h4"],
      out: "",
      err: {
        status: "RUNTIME_ERROR",
        text: pyRecursionTrace("count_down", "count_down(3)", "return [n] + count_down(n - 1)"),
      },
      misconception: "base-case-missing",
    },
    {
      key: "eq-zero",
      label: "Stops only at exactly zero",
      code: String.raw`def count_down(n):
    if n == 0:
        return []
    return [n] + count_down(n - 1)
`,
      failing: ["h1", "h3"],
      out: "[3, 2, 1]\n",
      misconception: "base-case-exact-zero",
    },
    {
      key: "stop-at-one",
      label: "Base case at 1 skips zero",
      code: String.raw`def count_down(n):
    if n == 1:
        return [1]
    return [n] + count_down(n - 1)
`,
      failing: ["t3", "h1", "h3"],
      out: "[3, 2, 1]\n",
      misconception: "base-case-assumes-zero",
    },
    {
      key: "missing-return",
      label: "Recursive result is not returned",
      code: String.raw`def count_down(n):
    if n <= 0:
        return []
    result = [n]
    result + count_down(n - 1)
`,
      failing: ["t1", "t2", "t4", "h2", "h4"],
      out: "None\n",
      misconception: "missing-return-recursive",
    },
  ],
  topics: [
    { key: "recursion-base-cases", weight: 1 },
    { key: "recursion", weight: 0.6 },
  ],
  rubric: [
    { title: "Correct results", description: "Public and hidden tests pass.", maxPoints: 7 },
    {
      title: "Base case handles every integer",
      description: "Terminates for zero and negative inputs.",
      maxPoints: 2,
    },
    { title: "Style", description: "Recursive, no loops, readable.", maxPoints: 1 },
  ],
  hints: [
    "What is the smallest input for which you already know the answer without calling count_down again?",
    "Run count_down(-2) mentally. What happens to n on each call? Does it ever reach the value your base case checks for?",
    'Think of a base case as a question: "Is there anything left to count?" What kind of comparison answers that for every integer?',
    "Outline: (1) if there is nothing left to count, return an empty list; (2) otherwise put n first and let the recursive call build the rest.",
    "Check the comparison in your base case. A condition that tests for one exact value can be skipped over by inputs that start past it.",
  ],
  scaffold: [
    {
      stage: "PREDICT",
      instructions:
        "Before running anything, predict what count_down(2) returns with the starter code. Why?",
      hint: "Count how many times count_down would be called.",
    },
    {
      stage: "TRACE",
      instructions: "Trace count_down(2) with your base case. List each call and its argument.",
      hint: "Draw one box per call.",
    },
    {
      stage: "COUNTEREXAMPLE",
      instructions: "Find an input where your function would never stop.",
      hint: "Try zero and negative numbers.",
    },
    { stage: "REPAIR", instructions: "Change the base case so every integer input terminates." },
  ],
};

const hw3q2: QuestionDef = {
  key: "sum-digits",
  title: "sum_digits",
  difficulty: 3,
  points: 10,
  type: "CODING",
  language: "PYTHON",
  entryPoint: "sum_digits",
  prompt: `## sum_digits(n)

Write a **recursive** function \`sum_digits(n)\` that returns the sum of the decimal digits of the non-negative integer \`n\`.

- \`sum_digits(123)\` returns \`6\`
- \`sum_digits(7)\` returns \`7\`
- \`sum_digits(0)\` returns \`0\`

Think about it this way: \`n % 10\` is the last digit and \`n // 10\` is everything else. Do not convert \`n\` to a string and do not use loops.`,
  starterCode: String.raw`def sum_digits(n):
    """Return the sum of the digits of n (n >= 0)."""
    if n < 10:
        return n
    # TODO: recursive case - combine the last digit with the sum of the rest
    return 0


print(sum_digits(123))
`,
  reference: String.raw`def sum_digits(n):
    """Return the sum of the digits of n (n >= 0)."""
    if n < 10:
        return n
    return n % 10 + sum_digits(n // 10)
`,
  tests: [
    f("t1", "sum_digits(5)", "PUBLIC", 1, "sum_digits", [5], 5),
    f("t2", "sum_digits(123)", "PUBLIC", 1, "sum_digits", [123], 6),
    f("t3", "sum_digits(0)", "PUBLIC", 1, "sum_digits", [0], 0),
    f("t4", "sum_digits(4096)", "PUBLIC", 1, "sum_digits", [4096], 19),
    f("h1", "sum_digits(10)", "HIDDEN", 1, "sum_digits", [10], 1),
    f("h2", "sum_digits(999)", "HIDDEN", 1, "sum_digits", [999], 27),
    f("h3", "sum_digits(1000000)", "HIDDEN", 1, "sum_digits", [1000000], 1),
    f("h4", "sum_digits(98765)", "HIDDEN", 1, "sum_digits", [98765], 35),
  ],
  variants: [
    {
      key: "starter",
      label: "Starter code (recursive case missing)",
      code: String.raw`def sum_digits(n):
    if n < 10:
        return n
    return 0
`,
      failing: ["t2", "t4", "h1", "h2", "h3", "h4"],
      out: "0\n",
    },
    {
      key: "no-base-case",
      label: "No base case",
      code: String.raw`def sum_digits(n):
    return n % 10 + sum_digits(n // 10)
`,
      failing: ["t1", "t2", "t3", "t4", "h1", "h2", "h3", "h4"],
      out: "",
      err: {
        status: "RUNTIME_ERROR",
        text: pyRecursionTrace(
          "sum_digits",
          "sum_digits(123)",
          "return n % 10 + sum_digits(n // 10)",
        ),
      },
      misconception: "base-case-missing",
    },
    {
      key: "float-division",
      label: "Uses / instead of //",
      code: String.raw`def sum_digits(n):
    if n == 0:
        return 0
    return n % 10 + sum_digits(n / 10)
`,
      failing: ["t1", "t2", "t4", "h1", "h2", "h3", "h4"],
      out: "6.666666666666666\n",
      misconception: "call-stack-shared-variable",
    },
  ],
  topics: [
    { key: "recursion", weight: 1 },
    { key: "recursion-base-cases", weight: 0.5 },
    { key: "call-stack-tracing", weight: 0.4 },
  ],
  rubric: [
    { title: "Correct results", description: "Public and hidden tests pass.", maxPoints: 7 },
    {
      title: "Recursive case combines last digit and remainder",
      description: "Uses n % 10 and n // 10 correctly.",
      maxPoints: 2,
    },
    { title: "Style", description: "No loops or string conversion.", maxPoints: 1 },
  ],
  hints: [
    "If you knew sum_digits(12) already, how would you get sum_digits(123) with one extra step?",
    "What does n // 10 give you for 123? What does n % 10 give you? Which one belongs inside the recursive call?",
    "Write the call tree for sum_digits(123) and write the value each call returns on the way back up.",
    "Outline: the sum for n is the last digit plus the sum for everything except the last digit.",
    "In Python, / and // do different things. Check which one you need when you drop the last digit.",
  ],
  scaffold: [
    { stage: "PREDICT", instructions: "Predict sum_digits(48). What are the two recursive calls?" },
    { stage: "TRACE", instructions: "Trace sum_digits(123): list each call and what it returns." },
    { stage: "REPAIR", instructions: "Complete the recursive case so the public tests pass." },
  ],
};

const hw4q1: QuestionDef = {
  key: "running-totals",
  title: "running_totals",
  difficulty: 2,
  points: 10,
  type: "CODING",
  language: "PYTHON",
  entryPoint: "running_totals",
  prompt: `## running_totals(nums)

Return a **new** list where element \`i\` is the sum of \`nums[0]\` through \`nums[i]\`.

- \`running_totals([1, 2, 3])\` returns \`[1, 3, 6]\`
- \`running_totals([])\` returns \`[]\`

Use a loop. Do not modify \`nums\`.`,
  starterCode: String.raw`def running_totals(nums):
    """Return the running (prefix) sums of nums as a new list."""
    result = []
    total = 0
    for i in range(len(nums)):
        # TODO: add nums[i] to total and record it in result
        pass
    return result


print(running_totals([1, 2, 3]))
`,
  reference: String.raw`def running_totals(nums):
    """Return the running (prefix) sums of nums as a new list."""
    result = []
    total = 0
    for i in range(len(nums)):
        total += nums[i]
        result.append(total)
    return result
`,
  tests: [
    f("t1", "running_totals([1, 2, 3])", "PUBLIC", 1, "running_totals", [[1, 2, 3]], [1, 3, 6]),
    f("t2", "running_totals([])", "PUBLIC", 1, "running_totals", [[]], []),
    f("t3", "running_totals([5])", "PUBLIC", 1, "running_totals", [[5]], [5]),
    f("t4", "running_totals([2, -1, 4])", "PUBLIC", 1, "running_totals", [[2, -1, 4]], [2, 1, 5]),
    f("h1", "all zeros", "HIDDEN", 1, "running_totals", [[0, 0, 0]], [0, 0, 0]),
    f("h2", "four values", "HIDDEN", 1, "running_totals", [[10, 20, 30, 40]], [10, 30, 60, 100]),
    f("h3", "all negative", "HIDDEN", 1, "running_totals", [[-1, -2, -3]], [-1, -3, -6]),
    f("h4", "five ones", "HIDDEN", 1, "running_totals", [[1, 1, 1, 1, 1]], [1, 2, 3, 4, 5]),
  ],
  variants: [
    {
      key: "starter",
      label: "Starter code (loop body empty)",
      code: String.raw`def running_totals(nums):
    result = []
    total = 0
    for i in range(len(nums)):
        pass
    return result
`,
      failing: ["t1", "t3", "t4", "h1", "h2", "h3", "h4"],
      out: "[]\n",
    },
    {
      key: "range-off-by-one",
      label: "Loop stops one element early",
      code: String.raw`def running_totals(nums):
    result = []
    total = 0
    for i in range(len(nums) - 1):
        total += nums[i]
        result.append(total)
    return result
`,
      failing: ["t1", "t3", "t4", "h1", "h2", "h3", "h4"],
      out: "[1, 3]\n",
      misconception: "off-by-one-range",
    },
    {
      key: "resets-total",
      label: "Total reset inside the loop",
      code: String.raw`def running_totals(nums):
    result = []
    for i in range(len(nums)):
        total = 0
        total += nums[i]
        result.append(total)
    return result
`,
      failing: ["t1", "t4", "h2", "h3", "h4"],
      out: "[1, 2, 3]\n",
    },
  ],
  topics: [
    { key: "lists", weight: 1 },
    { key: "control-flow", weight: 0.6 },
  ],
  rubric: [
    { title: "Correct results", description: "Public and hidden tests pass.", maxPoints: 8 },
    { title: "Does not modify input", description: "Returns a new list.", maxPoints: 1 },
    { title: "Style", description: "Clear names and a single pass.", maxPoints: 1 },
  ],
  hints: [
    "What does result[2] need to know about the earlier elements?",
    "Which variable carries information from one loop iteration to the next?",
    "Trace the loop on [1, 2, 3]: write total and result after each iteration.",
    "Outline: keep a running total outside the loop; on each iteration update it, then record it.",
    "Check the bounds of your range(...) against the length of the list.",
  ],
  scaffold: [
    { stage: "PREDICT", instructions: "Predict running_totals([4, 1]) before writing code." },
    { stage: "TRACE", instructions: "Trace your loop on [1, 2, 3], tracking total and result." },
    { stage: "REPAIR", instructions: "Fix the first failing public test, then re-run." },
  ],
};

const hw4q2: QuestionDef = {
  key: "remove-negatives",
  title: "remove_negatives",
  difficulty: 3,
  points: 10,
  type: "CODING",
  language: "PYTHON",
  entryPoint: "remove_negatives",
  prompt: `## remove_negatives(nums)

Return a **new** list containing only the values in \`nums\` that are greater than or equal to zero, in the original order. Zero stays.

- \`remove_negatives([1, -2, 3])\` returns \`[1, 3]\`
- \`remove_negatives([-1, -2, -3, 4])\` returns \`[4]\`

The list passed in must not be modified.`,
  starterCode: String.raw`def remove_negatives(nums):
    """Return a NEW list with only the values >= 0. Do not modify nums."""
    # TODO
    return nums


print(remove_negatives([1, -2, 3]))
`,
  reference: String.raw`def remove_negatives(nums):
    """Return a NEW list with only the values >= 0. Do not modify nums."""
    result = []
    for x in nums:
        if x >= 0:
            result.append(x)
    return result
`,
  tests: [
    f("t1", "remove_negatives([1, -2, 3])", "PUBLIC", 1, "remove_negatives", [[1, -2, 3]], [1, 3]),
    f(
      "t2",
      "remove_negatives([-1, -2, -3, 4])",
      "PUBLIC",
      1,
      "remove_negatives",
      [[-1, -2, -3, 4]],
      [4],
      "Check what happens when two negative values are next to each other.",
    ),
    f("t3", "remove_negatives([])", "PUBLIC", 1, "remove_negatives", [[]], []),
    f("t4", "remove_negatives([5, 6])", "PUBLIC", 1, "remove_negatives", [[5, 6]], [5, 6]),
    f("h1", "single negative", "HIDDEN", 1, "remove_negatives", [[-5]], []),
    f("h2", "zeros are kept", "HIDDEN", 1, "remove_negatives", [[0, -1, 0]], [0, 0]),
    f("h3", "all negative", "HIDDEN", 1, "remove_negatives", [[-1, -1, -1, -1]], []),
    f("h4", "alternating", "HIDDEN", 1, "remove_negatives", [[3, -3, 3, -3, 3]], [3, 3, 3]),
  ],
  variants: [
    {
      key: "starter",
      label: "Starter code (returns input)",
      code: String.raw`def remove_negatives(nums):
    return nums
`,
      failing: ["t1", "t2", "h1", "h2", "h3", "h4"],
      out: "[1, -2, 3]\n",
    },
    {
      key: "mutate-while-iterating",
      label: "Removes from the list while looping over it",
      code: String.raw`def remove_negatives(nums):
    for x in nums:
        if x < 0:
            nums.remove(x)
    return nums
`,
      failing: ["t2", "h3"],
      out: "[1, 3]\n",
      misconception: "mutate-while-iterating",
    },
    {
      key: "drops-zero",
      label: "Uses > 0 and drops zeros",
      code: String.raw`def remove_negatives(nums):
    result = []
    for x in nums:
        if x > 0:
            result.append(x)
    return result
`,
      failing: ["h2"],
      out: "[1, 3]\n",
    },
  ],
  topics: [
    { key: "lists", weight: 1 },
    { key: "control-flow", weight: 0.5 },
  ],
  rubric: [
    { title: "Correct results", description: "Public and hidden tests pass.", maxPoints: 7 },
    { title: "Does not modify input", description: "Original list is unchanged.", maxPoints: 2 },
    { title: "Style", description: "Readable loop and conditions.", maxPoints: 1 },
  ],
  hints: [
    "What could go wrong if the list changes size while a for loop is walking through it?",
    "Try [-1, -2, -3, 4] by hand. Which index does the loop visit after it removes the first element?",
    "Is there a way to keep the elements you want without deleting from the list you are reading?",
    "Outline: start with an empty result list; look at every element once; append the ones that qualify.",
    "Check the comparison for zero: the prompt says zero stays.",
  ],
  scaffold: [
    {
      stage: "PREDICT",
      instructions:
        "Predict what remove_negatives([-1, -2, 5]) returns if you delete items as you loop.",
    },
    {
      stage: "COUNTEREXAMPLE",
      instructions: "Find a list where deleting during iteration gives the wrong answer.",
    },
    { stage: "REPAIR", instructions: "Rewrite so the input list is never modified." },
  ],
};

const quizQ1: QuestionDef = {
  key: "trace-f3",
  title: "Trace f(3)",
  difficulty: 2,
  points: 2,
  type: "SHORT_ANSWER",
  language: "PYTHON",
  prompt: `Consider this function:

\`\`\`python
def f(n):
    if n == 0:
        return 0
    return n + f(n - 1)
\`\`\`

What value does \`f(3)\` return? Answer with a single number.`,
  tests: [],
  variants: [],
  topics: [
    { key: "call-stack-tracing", weight: 1 },
    { key: "recursion", weight: 0.5 },
  ],
  rubric: [{ title: "Correct value", description: "Answer is 6.", maxPoints: 2 }],
  hints: ["Write f(3) as 3 + f(2) and keep expanding.", "", "", "", ""],
  scaffold: [],
  answerKey: { accepted: ["6"], normalize: "trim" },
};

const quizQ2: QuestionDef = {
  key: "count-calls",
  title: "Count the calls",
  difficulty: 2,
  points: 2,
  type: "MULTIPLE_CHOICE",
  language: "PYTHON",
  prompt: `Using the same function \`f\` from the previous question, how many calls to \`f\` are made in total when you evaluate \`f(3)\`, **including** the original call?`,
  tests: [],
  variants: [],
  topics: [{ key: "call-stack-tracing", weight: 1 }],
  rubric: [{ title: "Correct choice", description: "Answer is 4.", maxPoints: 2 }],
  hints: ["List the argument of each call: f(3), f(2), ...", "", "", "", ""],
  scaffold: [],
  choices: [
    { id: "a", text: "3" },
    { id: "b", text: "4" },
    { id: "c", text: "5" },
    { id: "d", text: "6" },
  ],
  answerKey: { correct: "b" },
};

const quizQ3: QuestionDef = {
  key: "explain-no-base-case",
  title: "Explain a missing base case",
  difficulty: 3,
  points: 6,
  type: "ESSAY",
  language: "PYTHON",
  prompt: `A classmate writes this function and calls \`countdown(5)\`:

\`\`\`python
def countdown(n):
    print(n)
    countdown(n - 1)
\`\`\`

In 3-5 sentences, explain what happens when the program runs and why. Use the terms *base case* and *call stack* in your answer.`,
  tests: [],
  variants: [],
  topics: [
    { key: "recursion-base-cases", weight: 1 },
    { key: "call-stack-tracing", weight: 0.6 },
  ],
  rubric: [
    {
      title: "Identifies infinite recursion",
      description: "States that the function keeps calling itself and never stops.",
      maxPoints: 2,
    },
    {
      title: "Describes the call stack",
      description:
        "Explains that each call adds a frame and the stack grows until the limit is hit (RecursionError in Python).",
      maxPoints: 2,
    },
    {
      title: "Explains the role of a base case",
      description: "Says a base case would stop the recursion, e.g. when n reaches 0.",
      maxPoints: 2,
    },
  ],
  hints: [
    "Think about what has to be true for the function to ever stop calling itself.",
    "",
    "",
    "",
    "",
  ],
  scaffold: [],
  answerKey: {
    keyPoints: [
      "no base case",
      "infinite recursion",
      "stack grows / RecursionError",
      "base case stops recursion",
    ],
  },
};

const jsq1: QuestionDef = {
  key: "sum-evens",
  title: "sumEvens",
  difficulty: 2,
  points: 10,
  type: "CODING",
  language: "JAVASCRIPT",
  entryPoint: "sumEvens",
  prompt: `## sumEvens(nums)

Write a JavaScript function \`sumEvens(nums)\` that returns the sum of the **even** numbers in the array \`nums\`.

- \`sumEvens([1, 2, 3, 4])\` returns \`6\`
- \`sumEvens([])\` returns \`0\`
- Negative even numbers count: \`sumEvens([-2, -4, 3])\` returns \`-6\`

Use a loop (\`for\` or \`for...of\`).`,
  starterCode: String.raw`function sumEvens(nums) {
  let total = 0;
  for (let i = 0; i < nums.length; i++) {
    // TODO: add nums[i] to total when it is even
  }
  return total;
}

console.log(sumEvens([1, 2, 3, 4]));
`,
  reference: String.raw`function sumEvens(nums) {
  let total = 0;
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] % 2 === 0) {
      total += nums[i];
    }
  }
  return total;
}
`,
  tests: [
    f("t1", "sumEvens([1, 2, 3, 4])", "PUBLIC", 1, "sumEvens", [[1, 2, 3, 4]], 6),
    f("t2", "sumEvens([])", "PUBLIC", 1, "sumEvens", [[]], 0),
    f("t3", "sumEvens([7, 9])", "PUBLIC", 1, "sumEvens", [[7, 9]], 0),
    f("t4", "sumEvens([2])", "PUBLIC", 1, "sumEvens", [[2]], 2),
    f("h1", "negative evens", "HIDDEN", 1, "sumEvens", [[-2, -4, 3]], -6),
    f("h2", "zeros", "HIDDEN", 1, "sumEvens", [[0, 0]], 0),
    f("h3", "mixed", "HIDDEN", 1, "sumEvens", [[10, 15, 20]], 30),
    f("h4", "one through ten", "HIDDEN", 1, "sumEvens", [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]], 30),
  ],
  variants: [
    {
      key: "starter",
      label: "Starter code (condition missing)",
      code: String.raw`function sumEvens(nums) {
  let total = 0;
  for (let i = 0; i < nums.length; i++) {
  }
  return total;
}
`,
      failing: ["t1", "t4", "h1", "h3", "h4"],
      out: "0\n",
    },
    {
      key: "skips-first",
      label: "Loop starts at index 1",
      code: String.raw`function sumEvens(nums) {
  let total = 0;
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] % 2 === 0) {
      total += nums[i];
    }
  }
  return total;
}
`,
      failing: ["t4", "h1", "h3"],
      out: "6\n",
      misconception: "off-by-one-range",
    },
    {
      key: "sums-odds",
      label: "Adds odd numbers instead",
      code: String.raw`function sumEvens(nums) {
  let total = 0;
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] % 2 !== 0) {
      total += nums[i];
    }
  }
  return total;
}
`,
      failing: ["t1", "t3", "t4", "h1", "h3", "h4"],
      out: "4\n",
    },
  ],
  topics: [
    { key: "lists", weight: 1 },
    { key: "control-flow", weight: 0.7 },
  ],
  rubric: [
    { title: "Correct results", description: "Public and hidden tests pass.", maxPoints: 8 },
    { title: "Clear loop and condition", description: "Readable JavaScript.", maxPoints: 2 },
  ],
  hints: [
    "How can you tell whether a number is even?",
    "What does the % operator return for 4 % 2 and for 5 % 2?",
    "Trace the loop on [1, 2, 3, 4]: which iterations should change total?",
    "Outline: for each element, if it is even, add it to total.",
    "Check where your loop starts; index 0 is the first element.",
  ],
  scaffold: [
    { stage: "PREDICT", instructions: "Predict sumEvens([3, 4, 5, 6])." },
    { stage: "REPAIR", instructions: "Complete the loop body." },
  ],
};

const jsq2: QuestionDef = {
  key: "longest-word",
  title: "longestWord",
  difficulty: 3,
  points: 10,
  type: "CODING",
  language: "JAVASCRIPT",
  entryPoint: "longestWord",
  prompt: `## longestWord(words)

Return the longest string in the array \`words\`. If several strings tie for longest, return the **first** one. Return \`""\` for an empty array.

- \`longestWord(["a", "abc", "ab"])\` returns \`"abc"\`
- \`longestWord(["aa", "bb"])\` returns \`"aa"\``,
  starterCode: String.raw`function longestWord(words) {
  let best = "";
  for (const w of words) {
    // TODO: decide when w should replace best
  }
  return best;
}

console.log(longestWord(["a", "abc", "ab"]));
`,
  reference: String.raw`function longestWord(words) {
  let best = "";
  for (const w of words) {
    if (w.length > best.length) {
      best = w;
    }
  }
  return best;
}
`,
  tests: [
    f(
      "t1",
      "longestWord(['a','abc','ab'])",
      "PUBLIC",
      1,
      "longestWord",
      [["a", "abc", "ab"]],
      "abc",
    ),
    f("t2", "longestWord([])", "PUBLIC", 1, "longestWord", [[]], ""),
    f("t3", "longestWord(['hi'])", "PUBLIC", 1, "longestWord", [["hi"]], "hi"),
    f("t4", "tie returns first", "PUBLIC", 1, "longestWord", [["aa", "bb"]], "aa"),
    f("h1", "tie later in list", "HIDDEN", 1, "longestWord", [["x", "yyy", "zzz"]], "yyy"),
    f("h2", "empty strings", "HIDDEN", 1, "longestWord", [["", ""]], ""),
    f(
      "h3",
      "first of ties",
      "HIDDEN",
      1,
      "longestWord",
      [["alpha", "be", "gamma", "delta"]],
      "alpha",
    ),
    f("h4", "mixed lengths", "HIDDEN", 1, "longestWord", [["one", "three", "seven"]], "three"),
  ],
  variants: [
    {
      key: "starter",
      label: "Starter code (never replaces best)",
      code: String.raw`function longestWord(words) {
  let best = "";
  for (const w of words) {
  }
  return best;
}
`,
      failing: ["t1", "t3", "t4", "h1", "h3", "h4"],
      out: "\n",
    },
    {
      key: "ties-last",
      label: "Uses >= so later ties win",
      code: String.raw`function longestWord(words) {
  let best = "";
  for (const w of words) {
    if (w.length >= best.length) {
      best = w;
    }
  }
  return best;
}
`,
      failing: ["t4", "h1", "h3", "h4"],
      out: "abc\n",
    },
  ],
  topics: [
    { key: "lists", weight: 1 },
    { key: "control-flow", weight: 0.8 },
  ],
  rubric: [
    { title: "Correct results", description: "Public and hidden tests pass.", maxPoints: 8 },
    { title: "Clear loop and condition", description: "Readable JavaScript.", maxPoints: 2 },
  ],
  hints: [
    "What do you need to remember from earlier iterations to decide about the current word?",
    "When two words tie, which one should win? Which comparison operator does that?",
    "Trace ['aa', 'bb'] with your condition and write down best after each word.",
    "Outline: keep the best word so far; replace it only when the new word is strictly longer.",
    "Compare > and >= on a tie.",
  ],
  scaffold: [
    {
      stage: "PREDICT",
      instructions: "Predict longestWord(['aa', 'bb']) for a condition that uses >=.",
    },
    {
      stage: "COUNTEREXAMPLE",
      instructions: "Find an input where your condition picks the wrong word.",
    },
  ],
};

export const CSE115_ASSIGNMENTS: AssignmentDef[] = [
  {
    key: "hw3",
    courseKey: "cse115",
    title: "HW3: Recursion — count_down and sum_digits",
    description:
      "Write two small recursive functions. Focus on choosing a base case that every input reaches. Closed; reference solutions are released for review.",
    format: "CODING",
    language: "PYTHON",
    state: "CLOSED",
    openDay: -28,
    dueDay: -15,
    closed: true,
    solutionsReleased: true,
    attemptLimit: 5,
    objectives: ["LO-REC-1", "LO-REC-2"],
    startRate: 1,
    submitRate: 0.95,
    policyMaxLevel: 5,
    questions: [hw3q1, hw3q2],
  },
  {
    key: "hw4",
    courseKey: "cse115",
    title: "HW4: Lists and loops",
    description:
      "Practice building and filtering lists with loops. Watch your range bounds and avoid changing a list while you loop over it.",
    format: "CODING",
    language: "PYTHON",
    state: "PUBLISHED_PROTECTED",
    openDay: -10,
    dueDay: 5,
    attemptLimit: 5,
    objectives: ["LO-FLOW-1"],
    startRate: 0.8,
    submitRate: 0.5,
    policyMaxLevel: 5,
    questions: [hw4q1, hw4q2],
  },
  {
    key: "quiz2",
    courseKey: "cse115",
    title: "Quiz 2: Tracing function calls",
    description:
      "Short quiz on tracing recursive calls. Two auto-graded questions and one written explanation graded with a rubric.",
    format: "QUIZ",
    language: "PYTHON",
    state: "PUBLISHED_PROTECTED",
    openDay: -7,
    dueDay: 1,
    attemptLimit: 1,
    objectives: ["LO-REC-2"],
    startRate: 0.9,
    submitRate: 0.75,
    policyMaxLevel: 1,
    questions: [quizQ1, quizQ2, quizQ3],
  },
  {
    key: "js-arrays",
    courseKey: "cse115",
    title: "HW5: JavaScript arrays and loops",
    description: "The same loop patterns you used in Python, now in JavaScript.",
    format: "CODING",
    language: "JAVASCRIPT",
    state: "PUBLISHED_PROTECTED",
    openDay: -8,
    dueDay: 4,
    attemptLimit: 5,
    objectives: ["LO-FLOW-1"],
    startRate: 0.7,
    submitRate: 0.4,
    policyMaxLevel: 5,
    questions: [jsq1, jsq2],
  },
];
