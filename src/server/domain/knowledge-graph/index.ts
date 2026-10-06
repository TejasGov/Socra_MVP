import "server-only";
import { prisma, type DbOrTx } from "@/server/db";

/**
 * Relational knowledge graph helpers (TASK §17). Edges live in TopicRelationship:
 *   from PREREQUISITE_OF to   => `from` must be understood before `to`
 *   from PART_OF to           => `from` is a sub-topic of `to`
 * Recursive traversal uses WITH RECURSIVE (cycle-safe via a visited path array and a depth cap).
 */

export interface TopicRef {
  topicId: string;
  name: string;
  key: string;
  depth: number;
}

export interface WeightedTopic {
  topicId: string;
  weight: number;
}

const MAX_DEPTH = 10;

/** All transitive prerequisites of a topic (nearest first). */
export async function getPrerequisites(topicId: string, db: DbOrTx = prisma): Promise<TopicRef[]> {
  return db.$queryRaw<TopicRef[]>`
    WITH RECURSIVE prereq(id, depth, path) AS (
      SELECT r."fromTopicId", 1, ARRAY[${topicId}::text, r."fromTopicId"]
      FROM "TopicRelationship" r
      WHERE r."toTopicId" = ${topicId} AND r."type" = 'PREREQUISITE_OF'::"TopicRelationType"
      UNION ALL
      SELECT r."fromTopicId", p.depth + 1, p.path || r."fromTopicId"
      FROM "TopicRelationship" r
      JOIN prereq p ON r."toTopicId" = p.id
      WHERE r."type" = 'PREREQUISITE_OF'::"TopicRelationType"
        AND NOT (r."fromTopicId" = ANY(p.path))
        AND p.depth < ${MAX_DEPTH}
    )
    SELECT t."id" AS "topicId", t."name", t."key", MIN(p.depth)::int AS depth
    FROM prereq p JOIN "Topic" t ON t."id" = p.id
    GROUP BY t."id", t."name", t."key"
    ORDER BY depth, t."name"`;
}

/** All topics that (transitively) depend on this topic via PREREQUISITE_OF (nearest first). */
export async function getDescendants(topicId: string, db: DbOrTx = prisma): Promise<TopicRef[]> {
  return db.$queryRaw<TopicRef[]>`
    WITH RECURSIVE dep(id, depth, path) AS (
      SELECT r."toTopicId", 1, ARRAY[${topicId}::text, r."toTopicId"]
      FROM "TopicRelationship" r
      WHERE r."fromTopicId" = ${topicId} AND r."type" = 'PREREQUISITE_OF'::"TopicRelationType"
      UNION ALL
      SELECT r."toTopicId", d.depth + 1, d.path || r."toTopicId"
      FROM "TopicRelationship" r
      JOIN dep d ON r."fromTopicId" = d.id
      WHERE r."type" = 'PREREQUISITE_OF'::"TopicRelationType"
        AND NOT (r."toTopicId" = ANY(d.path))
        AND d.depth < ${MAX_DEPTH}
    )
    SELECT t."id" AS "topicId", t."name", t."key", MIN(d.depth)::int AS depth
    FROM dep d JOIN "Topic" t ON t."id" = d.id
    GROUP BY t."id", t."name", t."key"
    ORDER BY depth, t."name"`;
}

/** Topics directly related (any relation type, either direction). */
export async function getRelatedTopics(
  topicId: string,
  db: DbOrTx = prisma,
): Promise<{ topicId: string; name: string; type: string; direction: "out" | "in" }[]> {
  const [out, inc] = await Promise.all([
    db.topicRelationship.findMany({
      where: { fromTopicId: topicId },
      select: { type: true, toTopic: { select: { id: true, name: true } } },
    }),
    db.topicRelationship.findMany({
      where: { toTopicId: topicId },
      select: { type: true, fromTopic: { select: { id: true, name: true } } },
    }),
  ]);
  return [
    ...out.map((r) => ({
      topicId: r.toTopic.id,
      name: r.toTopic.name,
      type: r.type,
      direction: "out" as const,
    })),
    ...inc.map((r) => ({
      topicId: r.fromTopic.id,
      name: r.fromTopic.name,
      type: r.type,
      direction: "in" as const,
    })),
  ];
}

/** Topics a question assesses (QuestionTopic), with attribution weight. */
export async function getQuestionTopics(db: DbOrTx, questionId: string): Promise<WeightedTopic[]> {
  const rows = await db.questionTopic.findMany({
    where: { questionId },
    select: { topicId: true, weight: true },
  });
  return rows.map((r) => ({ topicId: r.topicId, weight: r.weight }));
}

/** Topics tagged on an assignment (fallback when an event has no question). */
export async function getAssignmentTopics(
  db: DbOrTx,
  assignmentId: string,
): Promise<WeightedTopic[]> {
  const rows = await db.assignmentTopic.findMany({
    where: { assignmentId },
    select: { topicId: true },
  });
  return rows.map((r) => ({ topicId: r.topicId, weight: 1 }));
}

/** Question topics when a question is known; otherwise the assignment's topics. */
export async function resolveTopics(
  db: DbOrTx,
  ref: { questionId?: string | null; assignmentId?: string | null },
): Promise<WeightedTopic[]> {
  if (ref.questionId) {
    const q = await getQuestionTopics(db, ref.questionId);
    if (q.length > 0) return q;
  }
  if (ref.assignmentId) return getAssignmentTopics(db, ref.assignmentId);
  return [];
}

export async function findTopicByKey(courseId: string, key: string, db: DbOrTx = prisma) {
  return db.topic.findUnique({ where: { courseId_key: { courseId, key } } });
}

export async function listCourseTopics(courseId: string, db: DbOrTx = prisma) {
  return db.topic.findMany({
    where: { courseId },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: { id: true, key: true, name: true, description: true, order: true },
  });
}
