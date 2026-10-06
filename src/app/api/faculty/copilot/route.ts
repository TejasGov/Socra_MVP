import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { suggestAssignmentContent } from "@/server/domain/authoring-ai";
import { assertSameOrigin, json, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  courseId: z.string().min(1),
  prompt: z.string().trim().min(3).max(4000),
  format: z.enum(["CODING", "WRITTEN", "QUIZ"]).default("CODING"),
  language: z.enum(["PYTHON", "JAVASCRIPT", "SCALA"]).nullable().optional(),
  topicIds: z.array(z.string()).max(20).optional(),
  assignmentId: z.string().nullable().optional(),
});

/**
 * POST { courseId, prompt, format, language?, topicIds? } -> { suggestionId, aiRequestId, suggestion }.
 * A pending AuthoringSuggestion row; nothing is published. Pass suggestionId as aiSuggestionId when creating.
 */
export const POST = route(async (req) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const input = await parseJson(req, schema);
  const { suggestionId, aiRequestId, ...suggestion } = await suggestAssignmentContent(user, input);
  return json({ suggestionId, aiRequestId, suggestion });
});

// Vercel function limit: long model generations need more than the default.
export const maxDuration = 120;
