import type { ResourceAccessScope, ResourceType } from "@/generated/prisma/enums";

export interface ResourceDef {
  key: string;
  courseKey: "cse115" | "cse116";
  title: string;
  type: ResourceType;
  accessScope: ResourceAccessScope;
  topics: string[];
  text: string;
}

export const RESOURCES: ResourceDef[] = [
  {
    key: "lec12-recursion",
    courseKey: "cse115",
    title: "Lecture 12: Recursion",
    type: "LECTURE_NOTES",
    accessScope: "COURSE_ALL",
    topics: ["recursion", "recursion-base-cases"],
    text: `# Lecture 12: Recursion

## What is recursion
A function is **recursive** if its body calls the function itself. Recursion works well when a problem can be described in terms of a smaller copy of the same problem. Summing a list is the sum of the first element and the sum of the rest of the list. A directory contains files and smaller directories.

Every correct recursive function has two parts: a **base case** that returns an answer directly, and a **recursive case** that makes the problem smaller and calls the function again.

## Base cases
A base case is a condition under which the function returns without making another recursive call. Without one, the calls never stop. Python raises \`RecursionError: maximum recursion depth exceeded\` when the call stack grows past about 1000 frames.

Ask two questions about every base case. First, is the answer correct for that input? Second, does **every** input reach it? A base case that tests for one exact value is fragile when the argument can skip over that value. For a function that subtracts 1 each time, a check like \`n == 0\` never fires for a starting value of -3, because the arguments are -3, -4, -5 and so on, moving away from zero. A comparison such as \`n <= 0\` covers every integer that is not positive.

## The recursive case
The recursive case must move toward a base case. Each call should receive a strictly smaller input: a smaller number, a shorter list, or a smaller subtree. Then combine the result of the recursive call with the work done in the current call, and **return** the combined value. Forgetting to return the recursive result is a common mistake: the function does the work and then returns \`None\`.

## Example: factorial
\`\`\`python
def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
\`\`\`
The base case handles 0 and 1 directly. For n = 4 the calls are factorial(4), factorial(3), factorial(2) and factorial(1). Values are multiplied on the way back up: 1, then 2, then 6, then 24.

## Designing a recursive function
1. Write down what the function returns for the smallest inputs.
2. Decide how to shrink the input.
3. Assume the recursive call returns the right answer for the smaller input, and decide how to build the answer for the current input from it.
4. Check that every possible input eventually reaches a base case.`,
  },
  {
    key: "lec13-callstack",
    courseKey: "cse115",
    title: "Lecture 13: Tracing recursive calls",
    type: "LECTURE_NOTES",
    accessScope: "COURSE_ALL",
    topics: ["call-stack-tracing", "recursion"],
    text: `# Lecture 13: Tracing recursive calls

## The call stack
Each time a function is called, Python creates a **frame** holding that call's arguments and local variables. Frames are stacked: the most recent call is on top. When a call returns, its frame is removed and the caller continues where it left off.

Each call has its own copy of its local variables. Two calls to the same function never share a parameter, even though the parameter has the same name.

## Tracing by hand
To trace \`f(3)\` for a function with \`return n + f(n - 1)\` and a base case \`f(0) = 0\`, write one line per call going down, then fill in return values going back up.

\`\`\`
f(3) -> 3 + f(2)
  f(2) -> 2 + f(1)
    f(1) -> 1 + f(0)
      f(0) -> 0
    f(1) = 1
  f(2) = 3
f(3) = 6
\`\`\`
Counting the lines shows that f(3) makes four calls in total: f(3), f(2), f(1) and f(0).

## Common tracing mistakes
- Writing the final answer as soon as the base case is reached. Values must travel back up through each waiting frame.
- Mixing up the order: calls happen top to bottom, returns happen bottom to top.
- Assuming a variable changed in a deeper call also changed in the caller. It did not, because each frame has its own copy.

## Printing while recursing
A print before the recursive call runs on the way down; a print after it runs on the way back up. Tracing a function that prints in both places shows the two phases clearly.`,
  },
  {
    key: "lec9-lists",
    courseKey: "cse115",
    title: "Lecture 9: Lists and loops",
    type: "LECTURE_NOTES",
    accessScope: "COURSE_ALL",
    topics: ["lists", "control-flow"],
    text: `# Lecture 9: Lists and loops

## Lists and indexes
A list stores values in order. Indexes start at 0, so a list with n elements has valid indexes 0 through n - 1. \`len(nums)\` gives n.

## Looping with range
\`for i in range(len(nums))\` visits every index. \`range(a, b)\` includes a and excludes b, which is why \`range(len(nums))\` ends at the last valid index. Writing \`range(len(nums) - 1)\` skips the last element, and \`range(1, len(nums))\` skips the first. These off-by-one errors are the most common loop bug.

## Accumulator pattern
Create the accumulator **before** the loop, update it inside the loop, and use it after the loop. If the accumulator is created inside the loop it is reset on every iteration.

\`\`\`python
total = 0
for x in nums:
    total += x
\`\`\`

## Building a new list
Start with an empty list and append items that qualify. This leaves the original list unchanged and avoids surprises.

## Do not change a list while looping over it
Removing items from a list while a for loop walks over it makes the loop skip elements, because the indexes of the remaining items shift left. Build a new list instead, or loop over a copy.

## Conditionals inside loops
Use an \`if\` inside the loop to choose which elements to count, add, or keep. Check boundary values such as zero and the empty list.`,
  },
  {
    key: "ref-js-arrays",
    courseKey: "cse115",
    title: "Reference: JavaScript arrays and loops",
    type: "READING",
    accessScope: "COURSE_ALL",
    topics: ["lists", "control-flow"],
    text: `# Reference: JavaScript arrays and loops

## Arrays
An array is an ordered list: \`const nums = [3, 1, 4];\`. \`nums.length\` is the number of elements and \`nums[0]\` is the first.

## Loops
The classic loop is \`for (let i = 0; i < nums.length; i++) { ... }\`. The \`for...of\` form visits each value directly: \`for (const x of nums) { ... }\`.

## Operators
\`%\` gives the remainder, so \`x % 2 === 0\` tests whether x is even. Use \`===\` rather than \`==\` for comparisons. For negative numbers, \`-4 % 2\` is -0, which is still equal to 0 under \`===\`.

## Strings
\`word.length\` is the number of characters. Comparing lengths with \`>\` keeps the first of several equal-length words; \`>=\` would replace it with each later word that ties.

## Building results
\`const out = [];\` then \`out.push(x);\` adds to the end. Return the new array rather than changing the input.`,
  },
  {
    key: "staff-recursion-errors",
    courseKey: "cse115",
    title: "Instructor notes: common recursion errors",
    type: "OTHER",
    accessScope: "STAFF_ONLY",
    topics: ["recursion", "recursion-base-cases"],
    text: `# Instructor notes: common recursion errors

## Base case reachability
Students often write the base case for the example in the prompt only. Hidden tests use negative inputs to check that the base case is reachable from every integer. Do not release these inputs before the solutions are released.

## Grading guidance
Award partial credit for correct recursive structure even if the base case is unreachable for some inputs. Note the misconception in feedback rather than only reporting failed tests.`,
  },
  {
    key: "lec5-bigo",
    courseKey: "cse116",
    title: "Lecture 5: Asymptotic complexity",
    type: "LECTURE_NOTES",
    accessScope: "COURSE_ALL",
    topics: ["asymptotic-complexity"],
    text: `# Lecture 5: Asymptotic complexity

## Why Big-O
Running time depends on the machine, but the way running time **grows** with input size n does not. Big-O notation describes that growth by keeping the dominant term and ignoring constant factors.

## Common growth rates
- O(1): constant, such as reading list[i].
- O(log n): the problem size is halved each step, such as binary search.
- O(n): one pass over the input.
- O(n log n): divide-and-conquer sorting such as merge sort.
- O(n^2): a loop nested inside a loop over the same data.

## O(n log n) is not O(n)
n log n grows faster than n. For n = 1,000,000, log2(n) is about 20, so an n log n algorithm does roughly twenty times the work of a linear one. The two are different classes even though log n grows slowly.

## Analyzing loops
Count how many times the innermost statement runs as a function of n. A single loop over n items is O(n). Two nested loops over n items run n * n times, which is O(n^2). Two loops one after the other are O(n) + O(n) = O(n).

## Analyzing recursion
Write the cost as a recurrence. A function that makes one call on n - 1 and does constant extra work runs in O(n). A function that splits the input in half twice and does linear work to combine the results is O(n log n).`,
  },
  {
    key: "lec7-linked",
    courseKey: "cse116",
    title: "Lecture 7: Linked lists",
    type: "LECTURE_NOTES",
    accessScope: "COURSE_ALL",
    topics: ["linked-structures"],
    text: `# Lecture 7: Linked lists

## Nodes and references
A singly linked list is a chain of nodes. Each node stores a value and a reference \`next\` to the following node. The last node's \`next\` is \`None\`. The list is identified by its **head**, the first node; an empty list has head \`None\`.

## Traversal
To visit every node, keep a variable \`current\` that starts at the head and **moves forward** at the end of each iteration.

\`\`\`python
current = head
while current is not None:
    # use current.value
    current = current.next
\`\`\`
If \`current = current.next\` is missing, \`current\` never changes and the loop runs forever. A loop condition of \`current.next is not None\` stops one node early and fails on an empty list because \`None\` has no attribute \`next\`.

## Searching
Walk the list and compare each node's value to the target. Return as soon as there is a match. If the loop ends, the target is not in the list.

## Costs
Reaching the k-th node takes k steps, so indexing is O(n), unlike an array. Inserting at the head is O(1) because only the head reference changes.

## Edge cases to check
The empty list, a one-node list, the target at the head, and the target at the tail.`,
  },
  {
    key: "lec9-trees",
    courseKey: "cse116",
    title: "Lecture 9: Trees and traversal",
    type: "LECTURE_NOTES",
    accessScope: "COURSE_ALL",
    topics: ["trees", "traversal"],
    text: `# Lecture 9: Trees and traversal

## Binary trees
A binary tree is either empty or a node with a value, a left subtree and a right subtree. This definition is recursive, so many tree functions are recursive too: handle the empty tree as the base case, then combine results from the two subtrees.

## Height
The height of an empty tree is 0. Otherwise it is 1 plus the larger of the heights of the two subtrees. Check for the empty tree before reading a node's fields.

## Traversal orders
A traversal visits every node exactly once. The three depth-first orders differ only in **when** the node itself is visited relative to its subtrees.
- **Preorder**: node, left, right.
- **Inorder**: left, node, right.
- **Postorder**: left, right, node.

For the tree with root 2, left child 1 and right child 3, preorder gives 2 1 3, inorder gives 1 2 3 and postorder gives 1 3 2. For a binary search tree, inorder produces the values in sorted order.

## Level-order
Level-order (breadth-first) visits nodes level by level using a queue instead of recursion.

## Common mistakes
Mixing up preorder and inorder by placing the node's value in the wrong position, forgetting the base case for an empty subtree, and visiting only one of the two subtrees.`,
  },
];
