import type { AssignmentDraftModelOutput, DraftQuestionType } from "../schemas";
import type { TopicKey } from "./mock-util";

/**
 * Deterministic quiz bank for the FACULTY_AUTHORING mock (format QUIZ). Every answer below was traced by hand;
 * each distractor corresponds to a named misconception so faculty analytics can attribute wrong answers.
 * Short-answer / trace keys use "||" between accepted answers (see src/lib/quiz.ts).
 */

type DraftQuestion = AssignmentDraftModelOutput["questions"][number];

interface QuizItem {
  type: Exclude<DraftQuestionType, "CODE">;
  title: string;
  prompt: string;
  /** Choice texts in order a, b, c, d (multiple choice only). */
  choices?: string[];
  /** Choice id ("a".."d") for multiple choice; accepted answers / key points joined by "||" otherwise. */
  answer: string;
  explanation: string;
  points: number;
  misconceptions: Array<[string, string]>;
  rubric?: Array<[string, string, number]>;
}

interface TopicBank {
  name: string;
  mc: [QuizItem, QuizItem];
  trace: QuizItem;
  short: QuizItem;
  written: QuizItem;
}

const py = (code: string) => "```python\n" + code.trim() + "\n```";

const BANKS: Record<"recursion" | "linked-lists" | "trees" | "complexity" | "lists" | "loops" | "functions", TopicBank> = {
  recursion: {
    name: "recursion and base cases",
    mc: [
      {
        type: "MULTIPLE_CHOICE",
        title: "Unreachable base case",
        prompt: `Consider this function:\n\n${py(`
def total(n):
    if n == 1:
        return 1
    return n + total(n - 1)
`)}\n\nWhat happens when you call \`total(0)\`?`,
        choices: [
          "It returns 0",
          "It returns 1",
          "It keeps calling itself with -1, -2, ... and Python raises a RecursionError",
          "It returns None",
        ],
        answer: "c",
        explanation:
          "total(0) calls total(-1), which calls total(-2), and so on. n moves away from 1, so the base case `n == 1` is never reached and the call stack grows until Python raises RecursionError. A base case only stops recursion if every input actually reaches it.",
        points: 2,
        misconceptions: [
          ["base case always reached", "Assumes any base case stops the recursion regardless of the input"],
          ["first call hits base case", "Believes the function returns the base-case value immediately"],
        ],
      },
      {
        type: "MULTIPLE_CHOICE",
        title: "Frames on the call stack",
        prompt: `Consider this function:\n\n${py(`
def fact(n):
    if n == 1:
        return 1
    return n * fact(n - 1)
`)}\n\nWhile evaluating \`fact(4)\`, how many \`fact\` frames are on the call stack at the moment \`fact(1)\` is running, **including** \`fact(1)\` itself?`,
        choices: ["1", "3", "4", "5"],
        answer: "c",
        explanation:
          "fact(4), fact(3), fact(2) and fact(1) are all active at once: each caller waits for the call it made to return before it can multiply. That is 4 frames. Python does not replace a frame when it recurses.",
        points: 2,
        misconceptions: [
          ["frames are replaced", "Thinks each recursive call replaces the previous frame"],
          ["off-by-one stack depth", "Does not count the base-case call, or counts a call to fact(0)"],
        ],
      },
    ],
    trace: {
      type: "TRACE",
      title: "Trace a print after the recursive call",
      prompt: `What does this program print? Write the printed values in order, separated by spaces.\n\n${py(`
def show(n):
    if n == 0:
        return
    show(n - 1)
    print(n)

show(3)
`)}`,
      answer: "1 2 3||1,2,3",
      explanation:
        "show(3) calls show(2) before printing, which calls show(1), which calls show(0) and returns. The prints then run as the calls return: show(1) prints 1, then show(2) prints 2, then show(3) prints 3. Answering 3 2 1 means the print was treated as if it ran before the recursive call.",
      points: 2,
      misconceptions: [["prints on the way down", "Treats code after the recursive call as if it ran before it"]],
    },
    short: {
      type: "SHORT_ANSWER",
      title: "Count the calls",
      prompt: `Consider this function:\n\n${py(`
def f(n):
    if n <= 1:
        return 1
    return f(n - 1) + f(n - 2)
`)}\n\nHow many calls to \`f\` are made in total when you evaluate \`f(4)\`, **including** the original call? Answer with a single number.`,
      answer: "9||nine",
      explanation:
        "Calls(f(0)) = Calls(f(1)) = 1. Calls(f(2)) = 1 + 1 + 1 = 3. Calls(f(3)) = 1 + Calls(f(2)) + Calls(f(1)) = 5. Calls(f(4)) = 1 + Calls(f(3)) + Calls(f(2)) = 1 + 5 + 3 = 9. The two branches both recompute f(2), which is why the count grows quickly.",
      points: 2,
      misconceptions: [["one call per level", "Counts one call per value of n instead of one per branch"]],
    },
    written: {
      type: "WRITTEN",
      title: "Explain a missing base case",
      prompt: `A classmate writes this function and calls \`countdown(5)\`:\n\n${py(`
def countdown(n):
    print(n)
    countdown(n - 1)
`)}\n\nIn 3-5 sentences, explain what happens when the program runs and why. Use the terms *base case* and *call stack*.`,
      answer:
        "no base case||infinite recursion||each call adds a frame; the stack grows until RecursionError||a base case such as n == 0 would stop it",
      explanation:
        "There is no base case, so every call makes another call. Each call adds a frame to the call stack, which grows until Python stops with RecursionError (after printing 5, 4, 3, ... into the negatives). Adding `if n == 0: return` before the recursive call gives the recursion a stopping point that every non-negative n reaches.",
      points: 4,
      misconceptions: [["recursion stops at zero by itself", "Expects the function to stop when n reaches 0 without a check"]],
      rubric: [
        ["Identifies infinite recursion", "States that the function never stops calling itself.", 1],
        ["Describes the call stack", "Each call adds a frame; the stack grows until RecursionError.", 2],
        ["Explains the role of a base case", "A check such as n == 0 that returns would stop it.", 1],
      ],
    },
  },
  "linked-lists": {
    name: "linked-list traversal",
    mc: [
      {
        type: "MULTIPLE_CHOICE",
        title: "Traversal stopping condition",
        prompt: `Nodes have fields \`value\` and \`next\` (\`None\` at the end).\n\n${py(`
def length(head):
    count = 0
    current = head
    while current.next is not None:
        count += 1
        current = current.next
    return count
`)}\n\nFor the list \`4 -> 7 -> 9\`, what does \`length(head)\` return?`,
        choices: ["3", "2", "4", "It raises AttributeError"],
        answer: "b",
        explanation:
          "The loop stops when current is the last node, before counting it: count becomes 1 at node 4, 2 at node 7, and the loop ends at node 9. It returns 2. The condition should be `while current is not None`. (On an empty list, head is None and `current.next` raises AttributeError.)",
        points: 2,
        misconceptions: [
          ["stops one node early", "Uses current.next instead of current as the loop condition"],
          ["dereferencing None", "Reads a field of None at the end of the list"],
        ],
      },
      {
        type: "MULTIPLE_CHOICE",
        title: "Cost of inserting at the front",
        prompt:
          "You have a reference to the head of a singly linked list with n nodes. What is the time complexity of inserting a new node at the **front** of the list?",
        choices: ["O(1)", "O(log n)", "O(n)", "O(n^2)"],
        answer: "a",
        explanation:
          "Inserting at the front only creates a node, points its next at the old head and updates head: a constant number of steps no matter how long the list is. Inserting at the back without a tail reference is the operation that needs O(n) traversal.",
        points: 2,
        misconceptions: [["every list operation traverses", "Assumes any linked-list insertion must walk the list"]],
      },
    ],
    trace: {
      type: "TRACE",
      title: "Trace a traversal",
      prompt: `What does this program print? Write the printed values in order, separated by spaces.\n\n${py(`
class Node:
    def __init__(self, value, next=None):
        self.value = value
        self.next = next

head = Node(1, Node(2, Node(3)))
head = Node(0, head)
current = head
while current is not None:
    print(current.value, end=" ")
    current = current.next
`)}`,
      answer: "0 1 2 3||0,1,2,3",
      explanation:
        "The list starts as 1 -> 2 -> 3. `Node(0, head)` makes a new node whose next is the old head, and head now points at it, so the list is 0 -> 1 -> 2 -> 3. The loop visits every node until current is None.",
      points: 2,
      misconceptions: [["prepend loses the list", "Thinks reassigning head discards the old nodes"]],
    },
    short: {
      type: "SHORT_ANSWER",
      title: "Advance the head",
      prompt:
        "A linked list holds `5 -> 8 -> 13`. After running `head = head.next`, what is `head.value`? Answer with a single number.",
      answer: "8",
      explanation:
        "`head.next` is the node holding 8, so after the assignment head refers to that node. The node holding 5 is no longer reachable from head.",
      points: 2,
      misconceptions: [["next is a value", "Confuses the next reference with the next value field"]],
    },
    written: {
      type: "WRITTEN",
      title: "Explain the loop condition",
      prompt:
        "Two students write a loop to visit every node of a linked list. One uses `while current is not None:` and the other uses `while current.next is not None:`. In 3-5 sentences, explain how the two loops behave differently, including on an empty list.",
      answer:
        "current.next version skips the last node||current.next version crashes on an empty list (AttributeError on None)||current is not None visits every node and handles the empty list",
      explanation:
        "`while current is not None` visits every node and does nothing for an empty list. `while current.next is not None` stops while current is still the last node, so the last node is not processed in the loop body, and on an empty list current is None so `current.next` raises AttributeError.",
      points: 4,
      misconceptions: [["stops one node early", "Uses current.next instead of current as the loop condition"]],
      rubric: [
        ["Last node", "Explains that the current.next loop skips the last node.", 2],
        ["Empty list", "Explains the AttributeError on an empty list.", 2],
      ],
    },
  },
  trees: {
    name: "binary trees and traversal",
    mc: [
      {
        type: "MULTIPLE_CHOICE",
        title: "Preorder traversal",
        prompt:
          "Insert 5, 3, 8, 1, 4 (in that order) into an empty binary search tree. What is the **preorder** traversal of the result?",
        choices: ["5 3 1 4 8", "1 3 4 5 8", "1 4 3 8 5", "5 3 8 1 4"],
        answer: "a",
        explanation:
          "The tree has root 5, left child 3 (with children 1 and 4) and right child 8. Preorder visits node, then left subtree, then right subtree: 5, 3, 1, 4, 8. 1 3 4 5 8 is inorder, 1 4 3 8 5 is postorder and 5 3 8 1 4 is level order.",
        points: 2,
        misconceptions: [
          ["traversal orders mixed up", "Confuses preorder with inorder or postorder"],
          ["preorder is level order", "Visits by depth instead of finishing the left subtree first"],
        ],
      },
      {
        type: "MULTIPLE_CHOICE",
        title: "Worst-case BST search",
        prompt:
          "A binary search tree is built by inserting 1, 2, 3, ..., n in increasing order. In the worst case, how does the time to search it for a value grow?",
        choices: ["O(1)", "O(log n)", "O(n)", "O(n log n)"],
        answer: "c",
        explanation:
          "Each new key is larger than every key so far, so it becomes the right child of the previous one: the tree is a chain of height n. Searching for the largest key visits all n nodes. O(log n) only holds when the tree stays balanced.",
        points: 2,
        misconceptions: [["BSTs are always balanced", "Assumes BST operations are O(log n) regardless of shape"]],
      },
    ],
    trace: {
      type: "TRACE",
      title: "Trace a recursive traversal",
      prompt: `\`t\` is the binary search tree built by inserting 5, 3, 8, 1, 4 in that order. What does \`visit(t)\` print? Write the values in order, separated by spaces.\n\n${py(`
def visit(t):
    if t is None:
        return
    visit(t.left)
    visit(t.right)
    print(t.value, end=" ")
`)}`,
      answer: "1 4 3 8 5||1,4,3,8,5",
      explanation:
        "The print comes after both recursive calls, so this is a postorder traversal: left subtree (1, 4, then 3), right subtree (8), then the root (5).",
      points: 2,
      misconceptions: [["traversal orders mixed up", "Confuses preorder with inorder or postorder"]],
    },
    short: {
      type: "SHORT_ANSWER",
      title: "Tree height",
      prompt:
        "For the binary search tree built by inserting 5, 3, 8, 1, 4 in that order, how many **nodes** are on the longest path from the root to a leaf? Answer with a single number.",
      answer: "3||three",
      explanation:
        "The longest paths are 5 -> 3 -> 1 and 5 -> 3 -> 4, each with 3 nodes (2 edges). Counting edges instead of nodes gives 2.",
      points: 2,
      misconceptions: [["off-by-one height", "Counts edges instead of nodes"]],
    },
    written: {
      type: "WRITTEN",
      title: "Explain an unbalanced tree",
      prompt:
        "In 3-5 sentences, explain why searching a binary search tree can take time proportional to n, and describe an insertion order that causes it.",
      answer:
        "search cost depends on the height||sorted insertion order builds a chain||height n means n comparisons||balanced trees keep height near log n",
      explanation:
        "Search follows one root-to-leaf path, so it costs about the height of the tree. Inserting keys in sorted order makes every new key a child of the previous one, producing a chain of height n, so a search can visit every node. Balanced trees keep the height near log2(n).",
      points: 4,
      misconceptions: [["BSTs are always balanced", "Assumes BST operations are O(log n) regardless of shape"]],
      rubric: [
        ["Height", "Connects search cost to the height of the tree.", 2],
        ["Insertion order", "Gives sorted (or reverse-sorted) insertion as the cause.", 2],
      ],
    },
  },
  complexity: {
    name: "runtime complexity",
    mc: [
      {
        type: "MULTIPLE_CHOICE",
        title: "Triangular nested loop",
        prompt: `What is the Big-O running time of this code in terms of n?\n\n${py(`
total = 0
for i in range(n):
    for j in range(i, n):
        total += 1
`)}`,
        choices: ["O(n)", "O(n log n)", "O(n^2)", "O(2^n)"],
        answer: "c",
        explanation:
          "The inner loop runs n, n - 1, ..., 1 times, for n(n + 1)/2 steps in total. Halving a quadratic count is still quadratic: O(n^2). Starting the inner loop at i changes the constant, not the growth rate.",
        points: 2,
        misconceptions: [["shrinking inner loop is faster", "Believes a shrinking inner loop changes the growth rate"]],
      },
      {
        type: "MULTIPLE_CHOICE",
        title: "Doubling loop",
        prompt: `What is the Big-O running time of this loop in terms of n?\n\n${py(`
i = 1
while i < n:
    i = i * 2
`)}`,
        choices: ["O(n)", "O(log n)", "O(n / 2)", "O(1)"],
        answer: "b",
        explanation:
          "i takes the values 1, 2, 4, 8, ..., so the loop runs about log2(n) times before i reaches n. O(n / 2) is just O(n) and would describe a loop that adds 2 each time.",
        points: 2,
        misconceptions: [["every loop is linear", "Counts any single loop as O(n)"]],
      },
    ],
    trace: {
      type: "TRACE",
      title: "Count loop iterations",
      prompt: `What does this program print?\n\n${py(`
count = 0
for i in range(4):
    for j in range(i):
        count += 1
print(count)
`)}`,
      answer: "6||six",
      explanation:
        "For i = 0, 1, 2, 3 the inner loop runs 0, 1, 2 and 3 times: 0 + 1 + 2 + 3 = 6. Answering 16 treats the inner loop as running 4 times every time.",
      points: 2,
      misconceptions: [["inner loop runs n times", "Ignores that the inner bound depends on i"]],
    },
    short: {
      type: "SHORT_ANSWER",
      title: "Doubling loop for n = 16",
      prompt: `For \`n = 16\`, how many times does the body of this loop run? Answer with a single number.\n\n${py(`
i = 1
while i < n:
    i = i * 2
`)}`,
      answer: "4||four",
      explanation:
        "The body runs with i = 1, 2, 4 and 8. After the fourth run i is 16, and `16 < 16` is false, so the loop stops: 4 times, which is log2(16).",
      points: 2,
      misconceptions: [["off-by-one loop count", "Counts the final failed test of the condition as an iteration"]],
    },
    written: {
      type: "WRITTEN",
      title: "Explain a quadratic bound",
      prompt: `A classmate says this code is O(n log n) "because the inner loop gets shorter each time". In 3-5 sentences, explain whether they are right.\n\n${py(`
for i in range(n):
    for j in range(i, n):
        print(i, j)
`)}`,
      answer:
        "inner loop runs n - i times||total is n(n + 1)/2||constant factors do not change Big-O||so it is O(n^2), not O(n log n)",
      explanation:
        "The inner loop runs n - i times, so the total is n + (n - 1) + ... + 1 = n(n + 1)/2. That is about n^2 / 2, and dropping the constant gives O(n^2). A shrinking inner loop only gives O(n log n) when it shrinks geometrically (for example halving).",
      points: 4,
      misconceptions: [["shrinking inner loop is faster", "Believes a shrinking inner loop changes the growth rate"]],
      rubric: [
        ["Counts the work", "Sums the inner-loop lengths to about n^2 / 2.", 2],
        ["Correct conclusion", "Concludes O(n^2) and explains why constants are dropped.", 2],
      ],
    },
  },
  lists: {
    name: "lists and indexing",
    mc: [
      {
        type: "MULTIPLE_CHOICE",
        title: "Aliasing",
        prompt: `What does this program print?\n\n${py(`
nums = [1, 2, 3]
other = nums
other.append(4)
print(len(nums))
`)}`,
        choices: ["3", "4", "It raises an error", "[1, 2, 3, 4]"],
        answer: "b",
        explanation:
          "`other = nums` does not copy the list: both names refer to the same list object. Appending through `other` changes that one list, so `len(nums)` is 4. Use `nums.copy()` or `nums[:]` for an independent copy.",
        points: 2,
        misconceptions: [["assignment copies lists", "Believes `other = nums` makes an independent copy"]],
      },
      {
        type: "MULTIPLE_CHOICE",
        title: "Slice bounds",
        prompt: "Given `nums = [10, 20, 30, 40]`, what is `nums[1:3]`?",
        choices: ["[10, 20, 30]", "[20, 30]", "[20, 30, 40]", "[10, 20]"],
        answer: "b",
        explanation:
          "A slice starts at the first index and stops before the second: indexes 1 and 2, which hold 20 and 30. Indexes start at 0, so index 1 is the second element.",
        points: 2,
        misconceptions: [
          ["slice end is inclusive", "Includes the element at the stop index"],
          ["indexes start at 1", "Treats index 1 as the first element"],
        ],
      },
    ],
    trace: {
      type: "TRACE",
      title: "Trace a filter loop",
      prompt: `What does this program print?\n\n${py(`
nums = [3, 1, 4, 1, 5]
result = []
for x in nums:
    if x > 2:
        result.append(x * 2)
print(result)
`)}`,
      answer: "[6, 8, 10]||6 8 10||6, 8, 10",
      explanation:
        "Only 3, 4 and 5 are greater than 2. Each is doubled before it is appended, so result is [6, 8, 10]. The 1s are skipped.",
      points: 2,
      misconceptions: [["filter and map order", "Applies the condition to the doubled value instead of the original"]],
    },
    short: {
      type: "SHORT_ANSWER",
      title: "Negative indexes",
      prompt: "Given `nums = [10, 20, 30, 40]`, what is the value of `nums[-1] + nums[1]`? Answer with a single number.",
      answer: "60||sixty",
      explanation: "`nums[-1]` is the last element, 40, and `nums[1]` is the second element, 20. 40 + 20 = 60.",
      points: 2,
      misconceptions: [["indexes start at 1", "Treats index 1 as the first element"]],
    },
    written: {
      type: "WRITTEN",
      title: "Explain aliasing",
      prompt:
        "In 3-5 sentences, explain the difference between `b = a` and `b = a.copy()` when `a` is a list, and give one situation where the difference causes a bug.",
      answer:
        "b = a makes both names refer to the same list||a.copy() makes a new list||changes through one alias show up in the other||example: modifying a parameter list inside a function",
      explanation:
        "`b = a` binds a second name to the same list object, so a change made through either name is visible through both. `a.copy()` creates a new list with the same elements, so later appends or assignments to it do not affect a. A common bug is a function that modifies a list it was passed, surprising the caller.",
      points: 4,
      misconceptions: [["assignment copies lists", "Believes `other = nums` makes an independent copy"]],
      rubric: [
        ["Same object vs new list", "Explains that assignment shares one object and copy() makes a new one.", 2],
        ["Concrete bug", "Gives a situation where shared mutation causes a wrong result.", 2],
      ],
    },
  },
  loops: {
    name: "loops and range bounds",
    mc: [
      {
        type: "MULTIPLE_CHOICE",
        title: "Range with a step",
        prompt: "How many numbers does `for i in range(2, 10, 3): print(i)` print?",
        choices: ["2", "3", "4", "8"],
        answer: "b",
        explanation:
          "range(2, 10, 3) produces 2, 5 and 8. The next value, 11, is not below the stop value 10. So 3 numbers are printed.",
        points: 2,
        misconceptions: [["range stop is inclusive", "Expects range to include or pass its stop value"]],
      },
      {
        type: "MULTIPLE_CHOICE",
        title: "Off-by-one bound",
        prompt: `What does this program print?\n\n${py(`
nums = [5, 6, 7]
for i in range(len(nums) - 1):
    print(nums[i], end=" ")
`)}`,
        choices: ["5 6 7", "5 6", "6 7", "It raises IndexError"],
        answer: "b",
        explanation:
          "range(len(nums) - 1) is range(2), which gives indexes 0 and 1, so it prints 5 6 and skips the last element. range(len(nums)) already stops before len(nums); subtracting 1 again is an off-by-one error.",
        points: 2,
        misconceptions: [["double off-by-one", "Subtracts 1 from a range stop that is already exclusive"]],
      },
    ],
    trace: {
      type: "TRACE",
      title: "Trace a loop with continue",
      prompt: `What does this program print?\n\n${py(`
total = 0
i = 0
while i < 5:
    i += 1
    if i == 3:
        continue
    total += i
print(total)
`)}`,
      answer: "12||twelve",
      explanation:
        "i takes the values 1 through 5 inside the loop. `continue` skips adding 3, so total = 1 + 2 + 4 + 5 = 12. Because i is incremented before the check, the loop does not get stuck at 3.",
      points: 2,
      misconceptions: [["continue exits the loop", "Treats continue like break"]],
    },
    short: {
      type: "SHORT_ANSWER",
      title: "Sum of a range",
      prompt: "What does `sum(range(1, 10, 2))` evaluate to? Answer with a single number.",
      answer: "25||twenty-five||twenty five",
      explanation: "range(1, 10, 2) is 1, 3, 5, 7, 9 (10 is excluded). Their sum is 25.",
      points: 2,
      misconceptions: [["range stop is inclusive", "Expects range to include or pass its stop value"]],
    },
    written: {
      type: "WRITTEN",
      title: "Explain an off-by-one error",
      prompt:
        "A loop is meant to print every element of a list but uses `for i in range(len(nums) - 1):`. In 3-5 sentences, explain which elements it misses and how to fix it.",
      answer:
        "range stops before its argument||it misses the last element||use range(len(nums)) or loop over nums directly",
      explanation:
        "range(k) produces 0 through k - 1. With k = len(nums) - 1 the last index, len(nums) - 1, is never produced, so the last element is skipped. Use `range(len(nums))`, or loop directly with `for x in nums`.",
      points: 4,
      misconceptions: [["double off-by-one", "Subtracts 1 from a range stop that is already exclusive"]],
      rubric: [
        ["Identifies the missed element", "States that the last element is skipped and why.", 2],
        ["Fix", "Gives a correct loop.", 2],
      ],
    },
  },
  functions: {
    name: "functions and return values",
    mc: [
      {
        type: "MULTIPLE_CHOICE",
        title: "Print is not return",
        prompt: `What is the value of \`result\` after this runs?\n\n${py(`
def add(a, b):
    print(a + b)

result = add(2, 3)
`)}`,
        choices: ["5", "None", '"5"', "It raises an error"],
        answer: "b",
        explanation:
          "add prints 5 but has no return statement, so it returns None, and result is None. print only displays a value; the caller can only use what the function returns.",
        points: 2,
        misconceptions: [["print returns the value", "Believes printing a value also returns it"]],
      },
      {
        type: "MULTIPLE_CHOICE",
        title: "Missing return",
        prompt: "In Python, what does a function return if it reaches the end of its body without a return statement?",
        choices: ["0", "None", "An empty string", "The last value it computed"],
        answer: "b",
        explanation: "A function that finishes without executing `return` returns None.",
        points: 2,
        misconceptions: [["implicit return of last value", "Expects the last expression to be returned automatically"]],
      },
    ],
    trace: {
      type: "TRACE",
      title: "Trace a parameter reassignment",
      prompt: `What does this program print? Write the printed values in order, separated by spaces.\n\n${py(`
def double(x):
    x = x * 2
    print(x)

y = 5
double(y)
print(y)
`)}`,
      answer: "10 5||10,5",
      explanation:
        "Inside double, x starts as 5 and is rebound to 10, which is printed. Rebinding the parameter does not change the caller's variable, so y is still 5.",
      points: 2,
      misconceptions: [["parameters alias variables", "Believes reassigning a parameter changes the caller's variable"]],
    },
    short: {
      type: "SHORT_ANSWER",
      title: "Default arguments",
      prompt: `What does \`f(4)\` return? Answer with a single number.\n\n${py(`
def f(a, b=3):
    return a * b
`)}`,
      answer: "12||twelve",
      explanation: "b is not passed, so it takes its default value 3: 4 * 3 = 12.",
      points: 2,
      misconceptions: [["default arguments are zero", "Expects missing arguments to be 0 or None"]],
    },
    written: {
      type: "WRITTEN",
      title: "Explain print versus return",
      prompt:
        "In 3-5 sentences, explain the difference between a function that prints its result and one that returns it. Describe what goes wrong when a caller tries to use the result of a function that only prints.",
      answer:
        "print displays a value but does not give it to the caller||return gives the value back to the caller||a function without return gives None||using None in arithmetic raises TypeError",
      explanation:
        "print shows a value on the screen; return hands the value back to the caller, which can store or compute with it. A function that only prints returns None, so code like `add(2, 3) + 1` raises TypeError.",
      points: 4,
      misconceptions: [["print returns the value", "Believes printing a value also returns it"]],
      rubric: [
        ["Distinguishes print and return", "Explains who receives the value in each case.", 2],
        ["Consequence", "Explains that the caller gets None and what fails.", 2],
      ],
    },
  },
};

function bankFor(topic: TopicKey): TopicBank {
  if (topic === "strings") return BANKS.lists;
  return BANKS[topic];
}

function toDraft(item: QuizItem): DraftQuestion {
  return {
    type: item.type,
    title: item.title,
    prompt: item.prompt,
    points: item.points,
    choices: (item.choices ?? []).map((text, i) => ({ id: String.fromCharCode(97 + i), text })),
    answer: item.answer,
    explanation: item.explanation,
    starterCode: "",
    publicTests: [],
    hiddenTestSuggestions: [],
    rubric: (item.rubric ?? []).map(([criterion, description, points]) => ({ criterion, description, points })),
    hintLadder: [],
    predictedMisconceptions: item.misconceptions.map(([label, description]) => ({ label, description })),
  };
}

/**
 * Five questions spread over the detected topics: two multiple choice, one code trace, one short answer and
 * one written explanation (the only question that needs a person to grade it).
 */
export function mockQuizQuestions(topics: TopicKey[]): { names: string[]; questions: DraftQuestion[] } {
  const banks: TopicBank[] = [];
  for (const t of topics) {
    const b = bankFor(t);
    if (!banks.includes(b)) banks.push(b);
  }
  if (banks.length === 0) banks.push(BANKS.functions);
  const used = banks.slice(0, 3);
  const at = (i: number) => used[i % used.length]!;
  const mcPool = [0, 1].flatMap((k) => used.map((b) => b.mc[k]));
  return {
    names: used.map((b) => b.name),
    questions: [mcPool[0]!, mcPool[1]!, at(0).trace, at(1).short, at(2).written].map(toDraft),
  };
}
