import type { TopicRelationType } from "@/generated/prisma/enums";
import { sid, type SeedContext } from "./context";
import type { SeedCourse } from "./courses";

interface SeedTopic {
  key: string;
  name: string;
  description: string;
}

const T = {
  variables: {
    key: "variables",
    name: "Variables",
    description: "Naming values, assignment, and basic types.",
  },
  controlFlow: {
    key: "control-flow",
    name: "Control flow",
    description: "Conditionals and loops.",
  },
  functions: {
    key: "functions",
    name: "Functions",
    description: "Parameters, return values and scope.",
  },
  lists: { key: "lists", name: "Lists", description: "Indexing, iteration and building lists." },
  recursion: {
    key: "recursion",
    name: "Recursion",
    description: "Functions defined in terms of themselves.",
  },
  baseCases: {
    key: "recursion-base-cases",
    name: "Recursive base cases",
    description: "Stopping conditions that every recursive path must reach.",
  },
  callStack: {
    key: "call-stack-tracing",
    name: "Call-stack tracing",
    description: "Tracing frames, arguments and return values through nested calls.",
  },
  complexity: {
    key: "asymptotic-complexity",
    name: "Asymptotic complexity",
    description: "Big-O reasoning about running time and space.",
  },
  linked: {
    key: "linked-structures",
    name: "Linked structures",
    description: "Nodes and references: linked lists and their operations.",
  },
  trees: { key: "trees", name: "Trees", description: "Binary trees and binary search trees." },
  traversal: {
    key: "traversal",
    name: "Traversal",
    description: "Pre-, in-, post-order and level-order traversal of trees.",
  },
} satisfies Record<string, SeedTopic>;

export const TOPICS_BY_COURSE: Record<SeedCourse["key"], SeedTopic[]> = {
  cse115: [T.variables, T.controlFlow, T.functions, T.lists, T.recursion, T.baseCases, T.callStack],
  cse116: [
    T.functions,
    T.recursion,
    T.baseCases,
    T.callStack,
    T.complexity,
    T.linked,
    T.trees,
    T.traversal,
  ],
};

type Edge = [from: string, type: TopicRelationType, to: string];

/** Directed edges: from <type> to. */
export const EDGES_BY_COURSE: Record<SeedCourse["key"], Edge[]> = {
  cse115: [
    ["variables", "PREREQUISITE_OF", "control-flow"],
    ["variables", "PREREQUISITE_OF", "lists"],
    ["control-flow", "PREREQUISITE_OF", "functions"],
    ["functions", "PREREQUISITE_OF", "recursion"],
    ["functions", "PREREQUISITE_OF", "call-stack-tracing"],
    ["recursion-base-cases", "PART_OF", "recursion"],
    ["call-stack-tracing", "PART_OF", "recursion"],
    ["lists", "RELATED_TO", "recursion"],
    ["control-flow", "RELATED_TO", "lists"],
  ],
  cse116: [
    ["functions", "PREREQUISITE_OF", "recursion"],
    ["recursion-base-cases", "PART_OF", "recursion"],
    ["call-stack-tracing", "PART_OF", "recursion"],
    ["recursion", "PREREQUISITE_OF", "linked-structures"],
    ["linked-structures", "PREREQUISITE_OF", "trees"],
    ["traversal", "PART_OF", "trees"],
    ["recursion", "PREREQUISITE_OF", "traversal"],
    ["recursion", "TRANSFER_TO", "traversal"],
    ["asymptotic-complexity", "RELATED_TO", "traversal"],
    ["asymptotic-complexity", "RELATED_TO", "linked-structures"],
  ],
};

export function topicId(courseKey: string, topicKey: string): string {
  return sid("topic", courseKey, topicKey);
}

export async function seedTopics(ctx: SeedContext): Promise<void> {
  let topicCount = 0;
  let edgeCount = 0;
  for (const courseKey of Object.keys(TOPICS_BY_COURSE) as SeedCourse["key"][]) {
    const courseId = ctx.ids.courses[courseKey];
    if (!courseId) throw new Error(`seedTopics: course ${courseKey} not seeded`);
    const topics = TOPICS_BY_COURSE[courseKey];
    for (const [order, t] of topics.entries()) {
      const topic = await ctx.prisma.topic.upsert({
        where: { courseId_key: { courseId, key: t.key } },
        create: {
          id: topicId(courseKey, t.key),
          courseId,
          key: t.key,
          name: t.name,
          description: t.description,
          order,
        },
        update: { name: t.name, description: t.description, order },
      });
      ctx.ids.topics[`${courseKey}:${t.key}`] = topic.id;
      topicCount++;
    }
    for (const [from, type, to] of EDGES_BY_COURSE[courseKey]) {
      const fromTopicId = ctx.ids.topics[`${courseKey}:${from}`];
      const toTopicId = ctx.ids.topics[`${courseKey}:${to}`];
      if (!fromTopicId || !toTopicId) throw new Error(`seedTopics: bad edge ${from} -> ${to}`);
      await ctx.prisma.topicRelationship.upsert({
        where: { fromTopicId_toTopicId_type: { fromTopicId, toTopicId, type } },
        create: { fromTopicId, toTopicId, type },
        update: {},
      });
      edgeCount++;
    }
  }
  ctx.log(`topics: ${topicCount}, relationships: ${edgeCount}`);
}
