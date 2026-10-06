export interface Turn {
  s: string;
  r: string;
  level: number;
}

/** Socratic exchanges keyed by question key. Replies never contain a full solution. */
export const DIALOGUES: Record<string, Turn[]> = {
  "count-down": [
    {
      s: "my count_down keeps crashing with RecursionError and I don't get why",
      r: "A RecursionError means the function kept calling itself until Python ran out of stack. Before we look at your code, what would count_down(1) return if you could answer it without calling count_down again?",
      level: 1,
    },
    {
      s: "i guess it returns [1]? or maybe empty",
      r: "Good instinct to ask about the smallest case. Try one step further down: what is the argument in the call that count_down(1) makes next, and what should the answer be for that argument?",
      level: 2,
    },
    {
      s: "the next one would be 0. so it should return [] right? I wrote if n == 0 return []",
      r: "That works for count_down(3). Now trace count_down(-2) by hand. Write down the argument in each of the first four calls. Does any of them equal 0?",
      level: 2,
    },
    {
      s: "oh. -2, -3, -4, -5. it never hits zero",
      r: "Right. So the check n == 0 only fires for inputs that start at zero or above. What kind of comparison would be true for zero and also for every negative number?",
      level: 3,
    },
    {
      s: "n <= 0? let me try that",
      r: "Try it with Run public tests, then also run your own call with a negative number to see the difference. What do you notice?",
      level: 1,
    },
  ],
  "sum-digits": [
    {
      s: "How do I get the last digit of a number?",
      r: "You are on the right track with that question. Python has an operator that gives the remainder after division. What do you get for 123 % 10, and what about 123 // 10?",
      level: 1,
    },
    {
      s: "3 and 12. so 3 is the last digit and 12 is the rest",
      r: "Exactly. If you already knew the digit sum of 12, how would you use it to get the digit sum of 123?",
      level: 2,
    },
    {
      s: "add 3 to it? so sum_digits(123) = 3 + sum_digits(12)",
      r: "That is the recursive case. Now think about when the chain stops: what is the smallest number whose digit sum you can state without making another call?",
      level: 2,
    },
    {
      s: "any single digit number, like under 10. ok i think i have it",
      r: "Good. Write it up and run the public tests. If one fails, trace that input and compare each call's value with what you expect.",
      level: 1,
    },
  ],
  "running-totals": [
    {
      s: "my running_totals returns the wrong list, I get [1, 2, 3] for [1, 2, 3]",
      r: "Let us look at what carries information from one iteration to the next. In your loop, where does the running sum live, and when is it created?",
      level: 1,
    },
    {
      s: "i set total = 0 inside the loop",
      r: "Trace the first two iterations on [1, 2, 3]. What is total at the end of iteration one, and what is it at the start of iteration two?",
      level: 2,
    },
    {
      s: "it goes back to 0 each time... so it should be outside?",
      r: "What happens if you create it before the loop starts? Predict the result for [1, 2, 3] and then run it.",
      level: 2,
    },
  ],
  "remove-negatives": [
    {
      s: "remove_negatives([-1, -2, -3, 4]) gives [-2, 4] and I don't understand",
      r: "Interesting output. Which elements does your loop actually look at? Try writing the list and the index your loop is on after each removal.",
      level: 1,
    },
    {
      s: "i remove -1 at index 0 and then it moves to index 1",
      r: "And what is at index 1 after -1 was removed from the list? Compare it to what was at index 1 before.",
      level: 2,
    },
    {
      s: "-3. so it skipped -2",
      r: "That is the effect of changing a list while looping over it. Is there a way to collect only the values you want without deleting from the list you are walking?",
      level: 3,
    },
    {
      s: "make a new list and append the ones >= 0",
      r: "That avoids the problem. Remember the prompt says zero stays, so check your comparison on zero.",
      level: 1,
    },
  ],
  "sum-evens": [
    {
      s: "how do i check if a number is even in javascript",
      r: "What does the remainder operator % give you for 4 % 2, and for 5 % 2? What pattern separates the two?",
      level: 1,
    },
    {
      s: "0 and 1. so even if remainder is 0",
      r: "Yes. Where in your loop does that check belong, and what should happen when it is true?",
      level: 2,
    },
    {
      s: "inside the loop, add it to total",
      r: "That matches what the prompt describes. Run the public tests and look at which one fails first if any.",
      level: 1,
    },
  ],
  "longest-word": [
    {
      s: "my longestWord returns the last word when they tie",
      r: 'What comparison decides when a new word replaces the best one so far? Test it on ["aa", "bb"] by hand.',
      level: 2,
    },
    {
      s: "i used >= i think",
      r: "Which word does >= pick when the lengths are equal, and which word does the prompt want?",
      level: 2,
    },
    {
      s: "ok > then",
      r: "Try it and check the tie tests.",
      level: 1,
    },
  ],
  "list-length": [
    {
      s: "my loop never ends for list_length",
      r: "A loop that never ends usually has a condition that never changes. What is the condition in your while loop, and which line changes it?",
      level: 1,
    },
    {
      s: "current is not None. nothing changes current",
      r: "Good diagnosis. Looking at a node, how do you get to the node after it?",
      level: 2,
    },
    {
      s: "current.next",
      r: "Where in the loop body should the variable be updated to that value, and what happens to the count?",
      level: 2,
    },
    {
      s: "ok it works now, got 4 for the example",
      r: "Nice. Before you submit, which inputs might behave differently? Try the empty list.",
      level: 1,
    },
  ],
  "index-of": [
    {
      s: "index_of works when the target is first but hangs otherwise",
      r: "That pattern is a useful clue. In the case that works, which statements run? In the case that hangs, which statements run repeatedly?",
      level: 2,
    },
    {
      s: "the return runs the first time. otherwise i never move",
      r: "So what has to happen on every iteration where the current node is not the target?",
      level: 2,
    },
    {
      s: "advance current and increase index",
      r: "Yes. Check that both updates happen on the same path.",
      level: 1,
    },
  ],
  inorder: [
    {
      s: "I'm new to Scala pattern matching. What goes in the Node case?",
      r: "The Node case gives you three names: left subtree, value and right subtree. The result is a List[Int]. Which of those three parts produce lists of values and which is a single value?",
      level: 1,
    },
    {
      s: "l and r are trees so recursion gives lists, v is one Int",
      r: "Right. The problem statement says inorder is left, node, right. In what order do the three pieces need to appear when you combine them?",
      level: 2,
    },
    {
      s: "i have v :: inorder(l) ::: inorder(r) but it prints 2 1 3 for the example",
      r: "What order is that output? Compare it with the tree: root 2, left 1, right 3. Where does the root appear in your output and where should it appear?",
      level: 2,
    },
    {
      s: "root is first. it should be in the middle. so left first then v then right",
      r: "That is the difference between preorder and inorder. Think about how to build a list that has the left results first, then v, then the right results.",
      level: 3,
    },
    {
      s: "inorder(l) ::: (v :: inorder(r)) ?",
      r: "Run the public tests and see whether that matches your expectation for the larger tree too.",
      level: 1,
    },
  ],
};

/** Student pressing for the answer. Used for REVISE/BLOCK policy outcomes. */
export const LEAK_ATTEMPT: Turn[] = [
  {
    s: "can you just write the whole function for me",
    r: "I can't write the solution for a graded assignment, but I can help you get unstuck. What have you tried so far, and what happened when you ran it?",
    level: 0,
  },
  {
    s: "I tried nothing, I'm out of time. just give me the code",
    r: "I understand the time pressure. Let's make the next step small: describe in your own words what the function should return for the simplest input. What is it?",
    level: 1,
  },
  {
    s: "ugh fine. for the smallest input it returns an empty thing",
    r: "Good. That is the start of your base case. What condition on the input tells you that you are in that smallest case?",
    level: 2,
  },
];

/** Frustrated student, escalated to staff at L6. */
export const ESCALATION: Turn[] = [
  {
    s: "I've been on this for four hours and nothing works. I'm going to fail this course",
    r: "Four hours is a lot, and it makes sense to feel stuck. Let's slow down. What does the error message say when you run your function?",
    level: 1,
  },
  {
    s: "RecursionError. i don't even know what that means. i feel like everyone else gets this",
    r: "Many students hit this error on this assignment. It means the function never stops calling itself. Let's find where it should stop. What should count_down return for the smallest input?",
    level: 2,
  },
  {
    s: "i can't do this. i think i need to talk to someone, i'm not okay with how stressed i am",
    r: "I'm glad you said that. I am going to flag this conversation for your instructor and TA so a person can follow up with you. You don't have to figure this out alone. Your course staff will see a short note from you, not this transcript.",
    level: 6,
  },
];

/** Post-assessment review of HW3 (solutions released). */
export const REVIEW: Turn[] = [
  {
    s: "I lost points on the hidden tests for count_down. Why did negative inputs fail?",
    r: "Now that solutions are released we can talk about it directly. Your base case checked for n == 0. What are the arguments of the first few calls when n starts at -3?",
    level: 2,
  },
  {
    s: "-3, -4, -5... it never gets to 0",
    r: "Exactly, so the function recursed until Python stopped it. The reference solution uses a comparison that is true for zero and for every negative number. Can you say why that is safer?",
    level: 3,
  },
  {
    s: "because every input eventually satisfies it",
    r: "Yes. When you write your next recursive function, check that every allowed input reaches the base case, not just the ones in the examples.",
    level: 3,
  },
];

/** Short exchange attached to a practice session explanation request. */
export const PRACTICE_EXPLAIN: Turn[] = [
  {
    s: "Can you explain why my answer was wrong?",
    r: "Let's look at the item again. Which part of the code did you evaluate first, and what value did you get at that step? Compare it with the explanation shown under the question.",
    level: 2,
  },
  {
    s: "I forgot that the second call has its own n",
    r: "That is the key idea: every call has its own copy of the parameter. Try the next item with a quick table of calls and arguments.",
    level: 2,
  },
];

export const WRITTEN_ANSWERS = {
  good: [
    "The function has no base case, so it keeps calling countdown(n - 1) forever. Each call adds a new frame to the call stack and none of them ever returns, so the stack grows until Python raises a RecursionError. A base case such as 'if n == 0: return' would stop the recursion.",
    "Since there is no base case the recursion never stops. Every call to countdown pushes another frame on the call stack, which eventually overflows and gives a RecursionError (maximum recursion depth exceeded). Adding a base case that returns when n reaches 0 would let the calls return.",
  ],
  partial: [
    "It will print 5, 4, 3, 2, 1, 0, -1 and so on forever because nothing tells it to stop. It needs a base case.",
    "The function calls itself again and again. Eventually the program crashes because the call stack gets too big.",
    "It never ends. You need a stopping condition so that it doesn't call itself anymore.",
  ],
  weak: ["It prints the numbers going down.", "It prints 5 then stops."],
};
