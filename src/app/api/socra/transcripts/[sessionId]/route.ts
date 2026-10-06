import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { readRawTranscript } from "@/server/domain/socra";
import { clientIp, json, parseQuery, route } from "@/server/http";

export const dynamic = "force-dynamic";

const schema = z.object({ reason: z.string().trim().max(1000).optional().default("") });

/**
 * GET ?reason=... -> raw transcript. Requires transcript:read_raw (eligible role + active privileged grant + reason).
 * Ordinary faculty always get 403. Every read writes AuditLog + TranscriptAccessLog.
 */
export const GET = route(async (req, ctx: { params: Promise<{ sessionId: string }> }) => {
  const user = await requireUser();
  const { sessionId } = await ctx.params;
  const { reason } = parseQuery(req, schema);
  const result = await readRawTranscript(user, sessionId, reason, {
    ip: clientIp(req),
    userAgent: req.headers.get("user-agent"),
  });
  return json(result, { headers: { "Cache-Control": "no-store" } });
});
