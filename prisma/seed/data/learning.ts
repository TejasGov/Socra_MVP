import type { PracticeItemType } from "@/generated/prisma/enums";

export interface MisconceptionDef {
  key: string;
  label: string;
  description: string;
  /** Topic key per course (a course is omitted when the misconception does not apply there). */
  topic: Partial<Record<"cse115" | "cse116", string>>;
}

export const MISCONCEPTIONS: MisconceptionDef[] = [
  {
    key: "base-case-assumes-zero",
    label: "Assumes all decreasing sequences reach zero",
    description:
      "Believes a countdown always passes through zero, or that the sequence stops at the value used in the example, so the base case is written for one expected endpoint.",
    topic: { cse115: "recursion-base-cases", cse116: "recursion-base-cases" },
  },
  {
    key: "base-case-exact-zero",
    label: "Confuses n < 0 with termination at exactly zero",
    description:
      "Writes the base case as n == 0 and does not see that negative inputs step away from zero, so the recursion never terminates for them.",
    topic: { cse115: "recursion-base-cases", cse116: "recursion-base-cases" },
  },
  {
    key: "base-case-missing",
    label: "Writes a recursive call with no base case",
    description:
      "Defines the recursive case but no condition that returns without recursing, which leads to RecursionError.",
    topic: { cse115: "recursion-base-cases", cse116: "recursion-base-cases" },
  },
  {
    key: "missing-return-recursive",
    label: "Missing return in recursive case",
    description:
      "Calls the function recursively but does not return the value, so callers receive None.",
    topic: { cse115: "recursion", cse116: "recursion" },
  },
  {
    key: "call-stack-shared-variable",
    label: "Believes recursive calls share one copy of a local variable",
    description:
      "Thinks a parameter changed in a deeper call also changes in the caller, or that all frames see the same value.",
    topic: { cse115: "call-stack-tracing", cse116: "call-stack-tracing" },
  },
  {
    key: "off-by-one-range",
    label: "Off-by-one in range bounds",
    description:
      "Uses a loop bound that skips the first or last element, or a loop condition that stops one step early.",
    topic: { cse115: "lists", cse116: "linked-structures" },
  },
  {
    key: "mutate-while-iterating",
    label: "Mutates list while iterating",
    description:
      "Removes or inserts items in a list while a for loop is walking over it, so elements are skipped.",
    topic: { cse115: "lists" },
  },
  {
    key: "print-vs-return",
    label: "Confuses print with return",
    description:
      "Uses print to produce a function's result, then expects the caller to receive it.",
    topic: { cse115: "functions", cse116: "functions" },
  },
  {
    key: "linked-list-pointer-not-advanced",
    label: "Fails to advance linked-list pointer",
    description:
      "Walks a linked list with a loop but never moves the current reference to the next node, so the loop does not end.",
    topic: { cse116: "linked-structures" },
  },
  {
    key: "preorder-inorder-confusion",
    label: "Confuses preorder and inorder traversal",
    description:
      "Visits the node before its left subtree (preorder) when inorder is required, or visits the right subtree first.",
    topic: { cse116: "traversal" },
  },
  {
    key: "nlogn-as-n",
    label: "Treats O(n log n) as O(n)",
    description: "Drops the logarithmic factor and classifies an n log n algorithm as linear.",
    topic: { cse116: "asymptotic-complexity" },
  },
  {
    key: "tree-empty-child-unchecked",
    label: "Reads fields of an empty subtree",
    description:
      "Accesses the value or children of a subtree without first checking whether it is empty.",
    topic: { cse116: "trees" },
  },
];

export interface PracticeDef {
  key: string;
  topic: string;
  courses: Array<"cse115" | "cse116">;
  difficulty: number;
  type: PracticeItemType;
  prompt: string;
  choices?: Array<{ id: string; text: string }>;
  answer: string;
  accepted?: string[];
  explanation: string;
  source?: "FACULTY" | "CACHED_GENERATED";
  pending?: boolean;
  misconception?: string;
}

const mc = (...texts: string[]) => texts.map((text, i) => ({ id: "abcd"[i] as string, text }));
const both: Array<"cse115" | "cse116"> = ["cse115", "cse116"];
const c115: Array<"cse115" | "cse116"> = ["cse115"];
const c116: Array<"cse115" | "cse116"> = ["cse116"];

export const PRACTICE: PracticeDef[] = [
  {
    key: "var-copy",
    topic: "variables",
    courses: c115,
    difficulty: 1,
    type: "MULTIPLE_CHOICE",
    prompt: "After `x = 5`, `y = x`, `x = 7`, what is the value of `y`?",
    choices: mc("5", "7", "12", "It is an error"),
    answer: "a",
    explanation:
      "`y = x` copies the value 5 at that moment. Reassigning x later does not change y.",
  },
  {
    key: "var-float",
    topic: "variables",
    courses: c115,
    difficulty: 2,
    type: "SHORT_ANSWER",
    prompt: "What type does `3 / 2` produce in Python? Answer with the type name.",
    answer: "float",
    accepted: ["float", "<class 'float'>"],
    explanation:
      "The `/` operator always produces a float in Python 3 (1.5). Use `//` for integer division.",
    source: "CACHED_GENERATED",
  },
  {
    key: "cf-range-count",
    topic: "control-flow",
    courses: c115,
    difficulty: 1,
    type: "MULTIPLE_CHOICE",
    prompt: "How many times does the body of `for i in range(4):` run?",
    choices: mc("3", "4", "5", "0"),
    answer: "b",
    explanation: "`range(4)` produces 0, 1, 2, 3: four values.",
  },
  {
    key: "cf-sum-trace",
    topic: "control-flow",
    courses: c115,
    difficulty: 2,
    type: "TRACE",
    prompt:
      "What does this code print?\n\n```python\ntotal = 0\nfor i in range(1, 4):\n    total += i\nprint(total)\n```",
    answer: "6",
    accepted: ["6"],
    explanation: "`range(1, 4)` is 1, 2, 3. The total goes 1, 3, 6.",
  },
  {
    key: "cf-while-trace",
    topic: "control-flow",
    courses: c115,
    difficulty: 3,
    type: "TRACE",
    prompt:
      "What does this code print?\n\n```python\nn = 10\nwhile n > 0:\n    n -= 3\nprint(n)\n```",
    answer: "-2",
    accepted: ["-2"],
    explanation:
      "n takes the values 10, 7, 4, 1, then -2. The loop stops when n is no longer greater than 0.",
  },
  {
    key: "fn-no-return",
    topic: "functions",
    courses: both,
    difficulty: 1,
    type: "MULTIPLE_CHOICE",
    prompt: "A Python function has no `return` statement. What does calling it evaluate to?",
    choices: mc("0", "An empty string", "None", "An error"),
    answer: "c",
    explanation: "A function without a return statement returns `None` after it finishes.",
    misconception: "print-vs-return",
  },
  {
    key: "fn-print-vs-return",
    topic: "functions",
    courses: both,
    difficulty: 2,
    type: "SHORT_ANSWER",
    prompt:
      "```python\ndef add(a, b):\n    print(a + b)\n\nx = add(2, 3)\n```\nWhat is the value of `x` afterwards?",
    answer: "None",
    accepted: ["none"],
    explanation:
      "`add` prints 5 but returns nothing, so `x` is `None`. Use `return a + b` to hand the value back.",
    misconception: "print-vs-return",
  },
  {
    key: "fn-param-scope",
    topic: "functions",
    courses: both,
    difficulty: 3,
    type: "TRACE",
    prompt:
      "What does this print? Separate the two values with a space.\n\n```python\ndef g(x):\n    x = x + 1\n    return x * 2\n\ny = 3\nprint(g(y), y)\n```",
    answer: "8 3",
    accepted: ["8 3"],
    explanation:
      "Inside g, x becomes 4 and the function returns 8. The variable y outside is unchanged, so it still prints 3.",
    source: "CACHED_GENERATED",
  },
  {
    key: "list-index",
    topic: "lists",
    courses: c115,
    difficulty: 1,
    type: "MULTIPLE_CHOICE",
    prompt: "If `nums = [4, 8, 15]`, what is `nums[1]`?",
    choices: mc("4", "8", "15", "It is an error"),
    answer: "b",
    explanation: "Indexes start at 0, so `nums[1]` is the second element, 8.",
  },
  {
    key: "list-append",
    topic: "lists",
    courses: c115,
    difficulty: 2,
    type: "TRACE",
    prompt:
      "What does this print?\n\n```python\nnums = [1, 2, 3]\nnums.append(4)\nprint(len(nums))\n```",
    answer: "4",
    accepted: ["4"],
    explanation: "`append` adds one element to the end, so the length goes from 3 to 4.",
  },
  {
    key: "list-range-bounds",
    topic: "lists",
    courses: c115,
    difficulty: 3,
    type: "MULTIPLE_CHOICE",
    prompt: "Which loop header visits every index of the list `nums`?",
    choices: mc(
      "`for i in range(len(nums) - 1):`",
      "`for i in range(len(nums)):`",
      "`for i in range(1, len(nums)):`",
      "`for i in range(len(nums) + 1):`",
    ),
    answer: "b",
    explanation:
      "`range(len(nums))` produces 0 through len-1. The first option skips the last index, the third skips index 0, and the fourth runs past the end.",
    misconception: "off-by-one-range",
  },
  {
    key: "list-mutate",
    topic: "lists",
    courses: c115,
    difficulty: 4,
    type: "TRACE",
    prompt:
      "What does this print?\n\n```python\nnums = [2, 4, 6, 7]\nfor x in nums:\n    if x % 2 == 0:\n        nums.remove(x)\nprint(nums)\n```",
    answer: "[4, 7]",
    accepted: ["[4, 7]"],
    explanation:
      "When 2 is removed the list shifts left, so the loop moves on to index 1, which is now 6, and skips 4. After removing 6 the loop ends. The result is [4, 7].",
    misconception: "mutate-while-iterating",
  },
  {
    key: "rec-need-base",
    topic: "recursion",
    courses: both,
    difficulty: 1,
    type: "MULTIPLE_CHOICE",
    prompt: "What must every recursive function have so that it can stop?",
    choices: mc("A loop", "A base case", "A global variable", "Two parameters"),
    answer: "b",
    explanation:
      "A base case returns an answer without another recursive call. Without it the calls never stop.",
  },
  {
    key: "rec-double-trace",
    topic: "recursion",
    courses: both,
    difficulty: 2,
    type: "TRACE",
    prompt:
      "What does this print?\n\n```python\ndef f(n):\n    if n == 0:\n        return 1\n    return 2 * f(n - 1)\n\nprint(f(3))\n```",
    answer: "8",
    accepted: ["8"],
    explanation: "f(3) = 2 * f(2) = 2 * 2 * f(1) = 2 * 2 * 2 * f(0) = 8.",
  },
  {
    key: "rec-missing-return",
    topic: "recursion",
    courses: both,
    difficulty: 3,
    type: "SHORT_ANSWER",
    prompt:
      "```python\ndef s(n):\n    if n == 0:\n        return 0\n    n + s(n - 1)\n\nprint(s(3))\n```\nWhat does this print?",
    answer: "None",
    accepted: ["none"],
    explanation:
      "The recursive line computes a value but does not return it, so the call falls off the end and returns None.",
    misconception: "missing-return-recursive",
  },
  {
    key: "bc-terminates-all",
    topic: "recursion-base-cases",
    courses: both,
    difficulty: 2,
    type: "MULTIPLE_CHOICE",
    prompt:
      "A function `count(n)` calls `count(n - 1)` in its recursive case. Which base-case condition makes it stop for **every** integer input?",
    choices: mc("`n == 0`", "`n == 1`", "`n <= 0`", "`n == -1`"),
    answer: "c",
    explanation:
      "`n <= 0` is reached by every starting value, positive or negative. The exact-value checks are skipped by inputs that start past that value.",
    misconception: "base-case-exact-zero",
  },
  {
    key: "bc-negative-input",
    topic: "recursion-base-cases",
    courses: both,
    difficulty: 3,
    type: "SHORT_ANSWER",
    prompt:
      "```python\ndef f(n):\n    if n == 0:\n        return 0\n    return f(n - 1) + 1\n```\nWhat happens when you call `f(-1)`?",
    answer: "RecursionError",
    accepted: [
      "recursionerror",
      "infinite recursion",
      "never stops",
      "maximum recursion depth exceeded",
      "recursion error",
    ],
    explanation:
      "The arguments are -1, -2, -3, ... and never equal 0, so the calls continue until Python raises RecursionError.",
    misconception: "base-case-exact-zero",
  },
  {
    key: "bc-countdown-claim",
    topic: "recursion-base-cases",
    courses: both,
    difficulty: 3,
    type: "MULTIPLE_CHOICE",
    prompt:
      'A student says: "A countdown always reaches zero, so `n == 0` is a fine base case." What is the flaw?',
    choices: mc(
      "Zero can never be reached by subtracting 1.",
      "If the input starts below zero, subtracting 1 moves further away from zero.",
      "Base cases must use `<`, never `==`.",
      "Recursive functions cannot take negative numbers.",
    ),
    answer: "b",
    explanation:
      "The claim only holds for starting values that are zero or above. The base case has to cover every input the function accepts.",
    misconception: "base-case-assumes-zero",
    source: "CACHED_GENERATED",
  },
  {
    key: "bc-step-two",
    topic: "recursion-base-cases",
    courses: both,
    difficulty: 4,
    type: "SHORT_ANSWER",
    prompt:
      "A recursive function calls itself with `n - 2`. Write a base-case condition (a Python expression using `n`) that makes it terminate for every integer, including odd inputs.",
    answer: "n <= 0",
    accepted: ["n <= 0", "n<=0", "n < 1", "n<1"],
    explanation:
      "Starting from an odd number, n - 2 steps over zero (3, 1, -1, ...), so `n == 0` never fires. An inequality such as `n <= 0` catches both cases.",
    misconception: "base-case-exact-zero",
  },
  {
    key: "cs-count-calls",
    topic: "call-stack-tracing",
    courses: both,
    difficulty: 2,
    type: "MULTIPLE_CHOICE",
    prompt:
      "```python\ndef f(n):\n    if n == 0:\n        return 0\n    return n + f(n - 1)\n```\nHow many calls to `f` are made when evaluating `f(2)`, including the first?",
    choices: mc("2", "3", "4", "5"),
    answer: "b",
    explanation: "The calls are f(2), f(1) and f(0).",
  },
  {
    key: "cs-print-order",
    topic: "call-stack-tracing",
    courses: both,
    difficulty: 3,
    type: "TRACE",
    prompt:
      "What does this print? Write the numbers in order, separated by spaces.\n\n```python\ndef show(n):\n    if n == 0:\n        return\n    print(n)\n    show(n - 1)\n    print(n)\n\nshow(2)\n```",
    answer: "2 1 1 2",
    accepted: ["2 1 1 2"],
    explanation:
      "The first print runs on the way down (2, then 1). After the base case, the second print runs on the way back up (1, then 2).",
  },
  {
    key: "cs-frames",
    topic: "call-stack-tracing",
    courses: both,
    difficulty: 4,
    type: "MULTIPLE_CHOICE",
    prompt:
      "In the recursion `f(3) -> f(2) -> f(1) -> f(0)`, how many separate copies of the parameter `n` exist when `f(0)` is running?",
    choices: mc("1", "3", "4", "It depends on the code"),
    answer: "c",
    explanation:
      "Each call has its own frame and its own n. Four calls are waiting or running, so four copies exist.",
    misconception: "call-stack-shared-variable",
    source: "CACHED_GENERATED",
  },
  {
    key: "cx-fastest-growth",
    topic: "asymptotic-complexity",
    courses: c116,
    difficulty: 1,
    type: "MULTIPLE_CHOICE",
    prompt: "Which of these grows fastest as n increases?",
    choices: mc("O(1)", "O(log n)", "O(n)", "O(n^2)"),
    answer: "d",
    explanation: "Quadratic growth outpaces linear, logarithmic and constant growth.",
  },
  {
    key: "cx-merge-sort",
    topic: "asymptotic-complexity",
    courses: c116,
    difficulty: 3,
    type: "MULTIPLE_CHOICE",
    prompt: "What is the running time of merge sort on n items?",
    choices: mc("O(n)", "O(n log n)", "O(n^2)", "O(log n)"),
    answer: "b",
    explanation: "The array is halved about log n times and each level does O(n) work to merge.",
    misconception: "nlogn-as-n",
  },
  {
    key: "cx-nested",
    topic: "asymptotic-complexity",
    courses: c116,
    difficulty: 3,
    type: "SHORT_ANSWER",
    prompt:
      "```python\nfor i in range(n):\n    for j in range(n):\n        count += 1\n```\nGive the Big-O running time in terms of n.",
    answer: "O(n^2)",
    accepted: ["o(n^2)", "n^2", "o(n*n)", "quadratic", "o(n**2)"],
    explanation: "The inner statement runs n * n times.",
  },
  {
    key: "cx-nlogn-vs-n",
    topic: "asymptotic-complexity",
    courses: c116,
    difficulty: 4,
    type: "MULTIPLE_CHOICE",
    prompt: "For n = 1,000,000, roughly how does n log2(n) compare with n?",
    choices: mc(
      "They are about equal",
      "n log n is about 20 times larger",
      "n log n is about 2 times larger",
      "n log n is smaller",
    ),
    answer: "b",
    explanation:
      "log2(1,000,000) is about 20, so n log n is about 20 times n. They are different growth classes.",
    misconception: "nlogn-as-n",
    source: "CACHED_GENERATED",
  },
  {
    key: "ll-last-next",
    topic: "linked-structures",
    courses: c116,
    difficulty: 1,
    type: "MULTIPLE_CHOICE",
    prompt: "In a singly linked list, what is the `next` reference of the last node?",
    choices: mc("The head", "None", "Itself", "0"),
    answer: "b",
    explanation: "`None` marks the end of the list.",
  },
  {
    key: "ll-count-trace",
    topic: "linked-structures",
    courses: c116,
    difficulty: 2,
    type: "TRACE",
    prompt:
      "What does this print?\n\n```python\nhead = Node(1, Node(2, Node(3)))\ncur = head\ncount = 0\nwhile cur is not None:\n    count += 1\n    cur = cur.next\nprint(count)\n```",
    answer: "3",
    accepted: ["3"],
    explanation: "The loop visits three nodes and then `cur` becomes None.",
  },
  {
    key: "ll-no-advance",
    topic: "linked-structures",
    courses: c116,
    difficulty: 3,
    type: "SHORT_ANSWER",
    prompt:
      "A loop walks a linked list with `while cur is not None:` but never executes `cur = cur.next`. What happens when the list has at least one node?",
    answer: "infinite loop",
    accepted: [
      "infinite loop",
      "never ends",
      "never stops",
      "runs forever",
      "loops forever",
      "timeout",
    ],
    explanation: "`cur` never changes, so the condition stays true and the loop never ends.",
    misconception: "linked-list-pointer-not-advanced",
  },
  {
    key: "ll-kth-cost",
    topic: "linked-structures",
    courses: c116,
    difficulty: 4,
    type: "MULTIPLE_CHOICE",
    prompt:
      "How long does it take to reach the k-th node of a singly linked list starting from the head?",
    choices: mc("O(1)", "O(log k)", "O(k)", "O(k^2)"),
    answer: "c",
    explanation: "You must follow `next` k times, one step per node.",
    source: "CACHED_GENERATED",
  },
  {
    key: "tr-empty-height",
    topic: "trees",
    courses: c116,
    difficulty: 1,
    type: "MULTIPLE_CHOICE",
    prompt:
      "Using the definition from lecture (nodes on the longest path), what is the height of an empty tree?",
    choices: mc("-1", "0", "1", "Undefined"),
    answer: "b",
    explanation: "An empty tree has no nodes, so its height is 0. A single node has height 1.",
  },
  {
    key: "tr-height-trace",
    topic: "trees",
    courses: c116,
    difficulty: 3,
    type: "TRACE",
    prompt:
      "A tree has root 1 with left child 2 and right child 3. Node 3 has a left child 4. Node 2 and node 4 are leaves. What is the height of the tree (nodes on the longest path)?",
    answer: "3",
    accepted: ["3"],
    explanation: "The longest path is 1 -> 3 -> 4, which has three nodes.",
  },
  {
    key: "tr-check-empty",
    topic: "trees",
    courses: c116,
    difficulty: 4,
    type: "SHORT_ANSWER",
    prompt:
      "In a recursive `height(tree)` where an empty tree is `None`, why must the function check for `None` before unpacking `value, left, right = tree`? Answer in one sentence.",
    answer: "Because an empty subtree is None and None cannot be unpacked.",
    accepted: ["none", "empty", "null"],
    explanation:
      "Subtrees of leaves are empty. Unpacking None raises a TypeError, so the base case must come first.",
    misconception: "tree-empty-child-unchecked",
    pending: true,
    source: "CACHED_GENERATED",
  },
  {
    key: "tv-inorder-def",
    topic: "traversal",
    courses: c116,
    difficulty: 2,
    type: "MULTIPLE_CHOICE",
    prompt: "In an inorder traversal of a binary tree, in what order are the three parts visited?",
    choices: mc("Node, left, right", "Left, node, right", "Left, right, node", "Right, node, left"),
    answer: "b",
    explanation: "Inorder is left subtree, node, right subtree.",
    misconception: "preorder-inorder-confusion",
  },
  {
    key: "tv-preorder-trace",
    topic: "traversal",
    courses: c116,
    difficulty: 3,
    type: "TRACE",
    prompt:
      "A tree has root 2 with left child 1 and right child 3. Write its **preorder** traversal separated by spaces.",
    answer: "2 1 3",
    accepted: ["2 1 3"],
    explanation: "Preorder visits the node first, then the left subtree, then the right subtree.",
    misconception: "preorder-inorder-confusion",
  },
  {
    key: "tv-postorder-trace",
    topic: "traversal",
    courses: c116,
    difficulty: 4,
    type: "TRACE",
    prompt:
      "A tree has root 4. Its left child is 2 (with children 1 and 3) and its right child is 5. Write the **postorder** traversal separated by spaces.",
    answer: "1 3 2 5 4",
    accepted: ["1 3 2 5 4"],
    explanation:
      "Postorder visits left subtree, right subtree, then the node: 1 3 2, then 5, then 4.",
  },
  {
    key: "tv-bst-inorder",
    topic: "traversal",
    courses: c116,
    difficulty: 3,
    type: "MULTIPLE_CHOICE",
    prompt: "What does an inorder traversal of a binary search tree produce?",
    choices: mc(
      "Values in sorted order",
      "Values in reverse order",
      "Values level by level",
      "Values in insertion order",
    ),
    answer: "a",
    explanation:
      "In a BST everything in the left subtree is smaller and everything in the right is larger, so left-node-right yields ascending order.",
    source: "CACHED_GENERATED",
  },
];
