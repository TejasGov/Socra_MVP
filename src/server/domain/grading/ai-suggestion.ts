import "server-only";
import type { CurrentUser } from "@/server/auth/current-user";
import { suggestWrittenGrade, type WrittenGradeSuggestion } from "@/server/domain/authoring-ai";
import { HttpError } from "@/server/http";

export type { WrittenGradeSuggestion };

/**
 * Calls the AI authoring service's suggestWrittenGrade. Tolerates failure: the faculty member can always grade by
 * hand, so an AI outage returns a message instead of throwing. Permission and flag errors still propagate.
 */
export async function suggestWrittenGradeSafe(
  user: CurrentUser,
  input: { submissionId: string; questionId: string },
): Promise<
  | { ok: true; value: WrittenGradeSuggestion & { aiRequestId?: string } }
  | { ok: false; message: string }
> {
  try {
    return { ok: true, value: await suggestWrittenGrade(user, input) };
  } catch (err) {
    if (err instanceof HttpError && err.status === 503) {
      return {
        ok: false,
        message: "The AI assistant is unavailable right now. You can score this answer yourself.",
      };
    }
    if (err instanceof HttpError || (err as { name?: string }).name === "AuthError") throw err;
    console.error("[grading] AI suggestion failed", err);
    return {
      ok: false,
      message: "The AI suggestion failed. You can still score this answer yourself.",
    };
  }
}
