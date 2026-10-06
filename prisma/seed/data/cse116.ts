import { fnTest as f, ioTest as io, TIMEOUT_TEXT } from "./helpers";
import type { AssignmentDef, QuestionDef } from "./types";

const NODE_CLASS = String.raw`class Node:
    def __init__(self, value, next=None):
        self.value = value
        self.next = next


def from_values(values):
    """Build a linked list from a Python list and return its head (provided)."""
    head = None
    for v in reversed(values):
        head = Node(v, head)
    return head

`;

const LL_MAIN_LENGTH = String.raw`

if __name__ == "__main__":
    values = [int(x) for x in input().split()]
    print(list_length(from_values(values)))
`;

const ll1: QuestionDef = {
  key: "list-length",
  title: "list_length",
  difficulty: 2,
  points: 10,
  type: "CODING",
  language: "PYTHON",
  prompt: `## list_length(head)

A singly linked list is made of \`Node\` objects with a \`value\` and a \`next\` reference (\`None\` marks the end). \`head\` is the first node, or \`None\` for an empty list.

Write \`list_length(head)\` so it returns the number of nodes. Use a **loop** that walks the list; do not convert the list to a Python list first.

The program reads one line of integers from standard input, builds the list with \`from_values\`, and prints your result. For example, input \`4 8 15 16\` prints \`4\`. An empty line prints \`0\`.`,
  starterCode:
    NODE_CLASS +
    String.raw`def list_length(head):
    """Return the number of nodes in the list starting at head."""
    count = 0
    current = head
    while current is not None:
        # TODO: count this node, then move to the next node
        pass
    return count
` +
    LL_MAIN_LENGTH,
  reference:
    NODE_CLASS +
    String.raw`def list_length(head):
    """Return the number of nodes in the list starting at head."""
    count = 0
    current = head
    while current is not None:
        count += 1
        current = current.next
    return count
` +
    LL_MAIN_LENGTH,
  tests: [
    io("t1", "four nodes", "PUBLIC", 1, "4 8 15 16\n", "4\n"),
    io(
      "t2",
      "empty list",
      "PUBLIC",
      1,
      "\n",
      "0\n",
      "What should the length of a list with no nodes be?",
    ),
    io("t3", "one node", "PUBLIC", 1, "7\n", "1\n"),
    io("t4", "eight nodes", "PUBLIC", 1, "1 2 3 4 5 6 7 8\n", "8\n"),
    io("h1", "zero value node", "HIDDEN", 1, "0\n", "1\n"),
    io(
      "h2",
      "twenty nodes",
      "HIDDEN",
      1,
      Array.from({ length: 20 }, (_, i) => i + 1).join(" ") + "\n",
      "20\n",
    ),
    io("h3", "negative values", "HIDDEN", 1, "-1 -2\n", "2\n"),
    io(
      "h4",
      "one hundred nodes",
      "HIDDEN",
      1,
      Array.from({ length: 100 }, (_, i) => i).join(" ") + "\n",
      "100\n",
    ),
  ],
  variants: [
    {
      key: "starter",
      label: "Starter code (loop body empty)",
      code:
        NODE_CLASS +
        String.raw`def list_length(head):
    count = 0
    current = head
    while current is not None:
        pass
    return count
` +
        LL_MAIN_LENGTH,
      failing: ["t1", "t3", "t4", "h1", "h2", "h3", "h4"],
      out: "",
      err: { status: "TIMEOUT", text: TIMEOUT_TEXT },
      misconception: "linked-list-pointer-not-advanced",
    },
    {
      key: "forgot-advance",
      label: "Counts but never moves to next",
      code:
        NODE_CLASS +
        String.raw`def list_length(head):
    count = 0
    current = head
    while current is not None:
        count += 1
    return count
` +
        LL_MAIN_LENGTH,
      failing: ["t1", "t3", "t4", "h1", "h2", "h3", "h4"],
      out: "",
      err: { status: "TIMEOUT", text: TIMEOUT_TEXT },
      misconception: "linked-list-pointer-not-advanced",
    },
    {
      key: "stops-early",
      label: "Loop condition checks current.next",
      code:
        NODE_CLASS +
        String.raw`def list_length(head):
    count = 0
    current = head
    while current.next is not None:
        count += 1
        current = current.next
    return count
` +
        LL_MAIN_LENGTH,
      failing: ["t1", "t2", "t3", "t4", "h1", "h2", "h3", "h4"],
      out: "3\n",
      misconception: "off-by-one-range",
    },
  ],
  topics: [
    { key: "linked-structures", weight: 1 },
    { key: "functions", weight: 0.3 },
  ],
  rubric: [
    { title: "Handles empty list", description: "Returns 0 for None.", maxPoints: 1 },
    { title: "Style", description: "Single loop, no auxiliary Python list.", maxPoints: 1 },
  ],
  hints: [
    "How do you get from one node to the next node?",
    "In your loop, what changes from one iteration to the next? What has to change so the loop eventually ends?",
    "Trace a list of two nodes: write current at the start of each iteration.",
    "Outline: start at head; while there is a node, count it and move to its next.",
    "Look at the line that moves current. Is it inside the loop body?",
  ],
  scaffold: [
    {
      stage: "PREDICT",
      instructions: "What happens to current if the loop body never changes it?",
    },
    { stage: "TRACE", instructions: "Trace list_length on the list 4 -> 8 -> None." },
    { stage: "REPAIR", instructions: "Make the loop visit each node exactly once." },
  ],
};

const IDX_MAIN = String.raw`

if __name__ == "__main__":
    values = [int(x) for x in input().split()]
    target = int(input())
    print(index_of(from_values(values), target))
`;

const ll2: QuestionDef = {
  key: "index-of",
  title: "index_of",
  difficulty: 3,
  points: 10,
  type: "CODING",
  language: "PYTHON",
  prompt: `## index_of(head, target)

Return the position (starting at 0) of the **first** node whose \`value\` equals \`target\`, or \`-1\` if no node has that value.

The program reads the list values on line 1 and the target on line 2. Example: input \`5 3 9\` and \`3\` prints \`1\`; target \`7\` prints \`-1\`.`,
  starterCode:
    NODE_CLASS +
    String.raw`def index_of(head, target):
    """Return the index of the first node with value == target, or -1."""
    index = 0
    current = head
    while current is not None:
        # TODO: check current, then move on
        pass
    return -1
` +
    IDX_MAIN,
  reference:
    NODE_CLASS +
    String.raw`def index_of(head, target):
    """Return the index of the first node with value == target, or -1."""
    index = 0
    current = head
    while current is not None:
        if current.value == target:
            return index
        current = current.next
        index += 1
    return -1
` +
    IDX_MAIN,
  tests: [
    io("t1", "target in middle", "PUBLIC", 1, "5 3 9\n3\n", "1\n"),
    io("t2", "target missing", "PUBLIC", 1, "5 3 9\n7\n", "-1\n"),
    io("t3", "empty list", "PUBLIC", 1, "\n4\n", "-1\n"),
    io("t4", "first of duplicates", "PUBLIC", 1, "2 2 2\n2\n", "0\n"),
    io("h1", "target last", "HIDDEN", 1, "1 2 3 4 5\n5\n", "4\n"),
    io("h2", "target first", "HIDDEN", 1, "10 20 30\n10\n", "0\n"),
    io("h3", "zero value", "HIDDEN", 1, "-3 0 3\n0\n", "1\n"),
    io("h4", "sixth node", "HIDDEN", 1, "1 2 3 4 5 6\n6\n", "5\n"),
  ],
  variants: [
    {
      key: "starter",
      label: "Starter code (loop body empty)",
      code:
        NODE_CLASS +
        String.raw`def index_of(head, target):
    index = 0
    current = head
    while current is not None:
        pass
    return -1
` +
        IDX_MAIN,
      failing: ["t1", "t2", "t4", "h1", "h2", "h3", "h4"],
      out: "",
      err: { status: "TIMEOUT", text: TIMEOUT_TEXT },
      misconception: "linked-list-pointer-not-advanced",
    },
    {
      key: "no-advance",
      label: "Checks the node but never advances",
      code:
        NODE_CLASS +
        String.raw`def index_of(head, target):
    index = 0
    current = head
    while current is not None:
        if current.value == target:
            return index
        index += 1
    return -1
` +
        IDX_MAIN,
      failing: ["t1", "t2", "h1", "h3", "h4"],
      out: "",
      err: { status: "TIMEOUT", text: TIMEOUT_TEXT },
      misconception: "linked-list-pointer-not-advanced",
    },
    {
      key: "one-based",
      label: "Index starts at 1",
      code:
        NODE_CLASS +
        String.raw`def index_of(head, target):
    index = 1
    current = head
    while current is not None:
        if current.value == target:
            return index
        current = current.next
        index += 1
    return -1
` +
        IDX_MAIN,
      failing: ["t1", "t4", "h1", "h2", "h3", "h4"],
      out: "2\n",
      misconception: "off-by-one-range",
    },
  ],
  topics: [
    { key: "linked-structures", weight: 1 },
    { key: "traversal", weight: 0.3 },
  ],
  rubric: [
    { title: "Stops at first match", description: "Returns immediately when found.", maxPoints: 1 },
    { title: "Style", description: "Clear variable names.", maxPoints: 1 },
  ],
  hints: [
    "What two pieces of information do you need to track while you walk the list?",
    "After you check a node and it is not the target, what must happen before the next iteration?",
    "Trace index_of on 5 -> 3 -> 9 with target 9: write index and current.value each time.",
    "Outline: walk with current and index; return index on a match; otherwise advance both; return -1 after the loop.",
    "Look at where current changes. Does every path through the loop body move it?",
  ],
  scaffold: [
    { stage: "PREDICT", instructions: "Predict what index_of returns for an empty list." },
    { stage: "TRACE", instructions: "Trace the walk for target 9 in 5 -> 3 -> 9." },
    { stage: "REPAIR", instructions: "Make sure every iteration moves to the next node." },
  ],
};

const SCALA_HEADER = String.raw`sealed trait Tree
case object Leaf extends Tree
case class Node(left: Tree, value: Int, right: Tree) extends Tree

`;
const SCALA_TAIL = String.raw`
  private def build(tokens: Iterator[String]): Tree = {
    val tok = tokens.next()
    if (tok == "#") Leaf
    else {
      val v = tok.toInt
      val l = build(tokens)
      val r = build(tokens)
      Node(l, v, r)
    }
  }

  def main(args: Array[String]): Unit = {
    val line = scala.io.StdIn.readLine()
    val tokens = line.trim.split("\\s+").iterator
    println(inorder(build(tokens)).mkString(" "))
  }
}
`;

const scalaQ: QuestionDef = {
  key: "inorder",
  title: "inorder traversal",
  difficulty: 4,
  points: 10,
  type: "CODING",
  language: "SCALA",
  prompt: `## inorder(t)

A binary tree is either \`Leaf\` (empty) or a \`Node(left, value, right)\`. Implement \`inorder(t: Tree): List[Int]\`, which returns the values in **inorder**: everything in the left subtree, then the node's own value, then everything in the right subtree.

The program reads the tree in preorder from one line of standard input, where \`#\` stands for an empty subtree. Example: \`2 1 # # 3 # #\` is the tree with root 2, left child 1 and right child 3, and prints \`1 2 3\`.

Your solution must be recursive and must not use mutable collections.`,
  starterCode:
    SCALA_HEADER +
    String.raw`object Main {
  // Inorder: left subtree, then this node's value, then right subtree.
  def inorder(t: Tree): List[Int] = t match {
    case Leaf => Nil
    case Node(l, v, r) => ??? // TODO
  }
` +
    SCALA_TAIL,
  reference:
    SCALA_HEADER +
    String.raw`object Main {
  // Inorder: left subtree, then this node's value, then right subtree.
  def inorder(t: Tree): List[Int] = t match {
    case Leaf => Nil
    case Node(l, v, r) => inorder(l) ::: (v :: inorder(r))
  }
` +
    SCALA_TAIL,
  tests: [
    io("t1", "single node", "PUBLIC", 1, "5 # #\n", "5\n"),
    io("t2", "root with two children", "PUBLIC", 1, "2 1 # # 3 # #\n", "1 2 3\n"),
    io("t3", "empty tree", "PUBLIC", 1, "#\n", "\n"),
    io(
      "t4",
      "seven node tree",
      "PUBLIC",
      1,
      "4 2 1 # # 3 # # 6 5 # # 7 # #\n",
      "1 2 3 4 5 6 7\n",
      "Inorder visits the left subtree before the node itself.",
    ),
    io("h1", "left skewed", "HIDDEN", 1, "3 2 1 # # # #\n", "1 2 3\n"),
    io("h2", "right skewed", "HIDDEN", 1, "1 # 2 # 3 # #\n", "1 2 3\n"),
    io("h3", "mixed shape", "HIDDEN", 1, "10 5 # 7 # # 20 15 # # #\n", "5 7 10 15 20\n"),
    io("h4", "negative values", "HIDDEN", 1, "0 -1 # # 1 # #\n", "-1 0 1\n"),
  ],
  variants: [
    {
      key: "starter",
      label: "Starter code (not implemented)",
      code:
        SCALA_HEADER +
        String.raw`object Main {
  def inorder(t: Tree): List[Int] = t match {
    case Leaf => Nil
    case Node(l, v, r) => ???
  }
` +
        SCALA_TAIL,
      failing: ["t1", "t2", "t4", "h1", "h2", "h3", "h4"],
      out: "",
      err: {
        status: "RUNTIME_ERROR",
        text: 'Exception in thread "main" scala.NotImplementedError: an implementation is missing\n\tat scala.Predef$.$qmark$qmark$qmark(Predef.scala:344)\n\tat Main$.inorder(Main.scala:8)',
      },
    },
    {
      key: "preorder",
      label: "Visits the node before the left subtree",
      code:
        SCALA_HEADER +
        String.raw`object Main {
  def inorder(t: Tree): List[Int] = t match {
    case Leaf => Nil
    case Node(l, v, r) => v :: inorder(l) ::: inorder(r)
  }
` +
        SCALA_TAIL,
      failing: ["t2", "t4", "h1", "h3", "h4"],
      out: "2 1 3\n",
      misconception: "preorder-inorder-confusion",
    },
    {
      key: "right-first",
      label: "Visits the right subtree first",
      code:
        SCALA_HEADER +
        String.raw`object Main {
  def inorder(t: Tree): List[Int] = t match {
    case Leaf => Nil
    case Node(l, v, r) => inorder(r) ::: (v :: inorder(l))
  }
` +
        SCALA_TAIL,
      failing: ["t2", "t4", "h1", "h2", "h3", "h4"],
      out: "3 2 1\n",
      misconception: "preorder-inorder-confusion",
    },
  ],
  topics: [
    { key: "traversal", weight: 1 },
    { key: "trees", weight: 0.7 },
    { key: "recursion", weight: 0.4 },
  ],
  rubric: [
    { title: "Recursive structure", description: "Handles Leaf and Node cases.", maxPoints: 1 },
    { title: "Style", description: "Idiomatic Scala, no mutation.", maxPoints: 1 },
  ],
  hints: [
    "In what order should the three pieces (left, node, right) appear in the answer?",
    "Which of the two recursive calls should produce values that come before the node's value?",
    "Trace inorder on the tree 2 with children 1 and 3. What does each call return?",
    "Outline: the result is the inorder of the left subtree, followed by the node's value, followed by the inorder of the right subtree.",
    "Compare the order of your three pieces with the order in the problem statement.",
  ],
  scaffold: [
    {
      stage: "PREDICT",
      instructions:
        "Predict the output for the tree 2 with children 1 and 3 if you list the node first.",
    },
    {
      stage: "TRACE",
      instructions: "Trace inorder on a three-node tree, writing the list each call returns.",
    },
    { stage: "REPAIR", instructions: "Reorder the pieces so the public tests pass." },
  ],
};

const heightQ: QuestionDef = {
  key: "height",
  title: "tree height",
  difficulty: 3,
  points: 10,
  type: "CODING",
  language: "PYTHON",
  entryPoint: "height",
  prompt: `## height(tree)

A binary tree is \`None\` (empty) or a list \`[value, left, right]\` where \`left\` and \`right\` are trees. Write a recursive function \`height(tree)\` that returns the number of nodes on the longest path from the root down to a leaf. The height of an empty tree is \`0\`.

- \`height(None)\` returns \`0\`
- \`height([1, None, None])\` returns \`1\`
- \`height([1, [2, None, None], None])\` returns \`2\``,
  starterCode: String.raw`def height(tree):
    """Number of nodes on the longest root-to-leaf path (0 for an empty tree)."""
    # TODO: base case
    value, left, right = tree
    # TODO: combine the heights of the two subtrees
    return 0
`,
  reference: String.raw`def height(tree):
    """Number of nodes on the longest root-to-leaf path (0 for an empty tree)."""
    if tree is None:
        return 0
    value, left, right = tree
    return 1 + max(height(left), height(right))
`,
  tests: [
    f("t1", "empty tree", "PUBLIC", 1, "height", [null], 0),
    f("t2", "single node", "PUBLIC", 1, "height", [[1, null, null]], 1),
    f("t3", "left child only", "PUBLIC", 1, "height", [[1, [2, null, null], null]], 2),
    f(
      "t4",
      "unbalanced",
      "PUBLIC",
      1,
      "height",
      [[1, [2, [3, null, null], null], [4, null, null]]],
      3,
    ),
    f(
      "h1",
      "right chain",
      "HIDDEN",
      1,
      "height",
      [[1, null, [2, null, [3, null, [4, null, null]]]]],
      4,
    ),
    f(
      "h2",
      "mixed",
      "HIDDEN",
      1,
      "height",
      [[5, [3, [2, null, null], [4, null, null]], [8, null, null]]],
      3,
    ),
    f("h3", "zero value", "HIDDEN", 1, "height", [[0, null, null]], 1),
    f(
      "h4",
      "perfect tree",
      "HIDDEN",
      1,
      "height",
      [[1, [2, [4, null, null], [5, null, null]], [3, [6, null, null], [7, null, null]]]],
      3,
    ),
  ],
  variants: [],
  topics: [
    { key: "trees", weight: 1 },
    { key: "recursion", weight: 0.6 },
    { key: "recursion-base-cases", weight: 0.5 },
  ],
  rubric: [
    { title: "Base case for empty tree", description: "Returns 0 for None.", maxPoints: 2 },
  ],
  hints: [
    "What is the height of a tree with no nodes?",
    "How does the height of a tree relate to the heights of its two subtrees?",
    "Draw a three-node tree and write each subtree's height next to it.",
    "Outline: empty tree -> 0; otherwise 1 plus the larger of the two subtree heights.",
    "Check that your function handles None before it unpacks the list.",
  ],
  scaffold: [
    { stage: "PREDICT", instructions: "Predict the height of a tree with one node." },
    { stage: "REPAIR", instructions: "Add the base case, then the recursive combination." },
  ],
};

export const CSE116_ASSIGNMENTS: AssignmentDef[] = [
  {
    key: "hw2",
    courseKey: "cse116",
    title: "HW2: Linked list traversal",
    description:
      "Walk a singly linked list with a loop. Make sure every iteration moves to the next node.",
    format: "CODING",
    language: "PYTHON",
    state: "PUBLISHED_PROTECTED",
    openDay: -21,
    dueDay: -5,
    attemptLimit: 5,
    objectives: ["LO-LL-1"],
    startRate: 0.95,
    submitRate: 0.85,
    policyMaxLevel: 5,
    questions: [ll1, ll2],
  },
  {
    key: "hw3",
    courseKey: "cse116",
    title: "HW3: Binary tree traversal",
    description: "Implement an inorder traversal of a binary tree in Scala.",
    format: "CODING",
    language: "SCALA",
    state: "PUBLISHED_PROTECTED",
    openDay: -9,
    dueDay: 6,
    attemptLimit: 5,
    objectives: ["LO-TREE-1"],
    startRate: 0.7,
    submitRate: 0.4,
    policyMaxLevel: 5,
    questions: [scalaQ],
  },
  {
    key: "hw4-draft",
    courseKey: "cse116",
    title: "HW4: Tree height (draft)",
    description: "Recursive functions on binary trees. Draft: not yet visible to students.",
    format: "CODING",
    language: "PYTHON",
    state: "DRAFT",
    openDay: null,
    dueDay: null,
    attemptLimit: 5,
    objectives: ["LO-TREE-1"],
    startRate: 0,
    submitRate: 0,
    policyMaxLevel: 5,
    questions: [heightQ],
  },
];
