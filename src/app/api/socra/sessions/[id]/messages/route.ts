import { z } from "zod";
import { requireUser } from "@/server/auth/current-user";
import { sendSocraMessage, type SocraSseEvent } from "@/server/domain/socra";
import { assertSameOrigin, parseJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

const schema = z.object({
  content: z.string().min(1).max(4000),
  workspace: z
    .object({ code: z.string().max(60_000), language: z.string().nullable().optional() })
    .nullable()
    .optional(),
});

/**
 * POST { content, workspace? } -> text/event-stream of
 *   data: {"type":"delta","text"} ... data: {"type":"done",...} | data: {"type":"error","code","message"}
 * Auth/ownership/validation errors are returned as JSON before the stream starts.
 */
export const POST = route(async (req, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const user = await requireUser();
  const { id } = await ctx.params;
  const input = await parseJson(req, schema);

  const iterator = sendSocraMessage(user, id, input, req.signal)[Symbol.asyncIterator]();
  // Pull the first event eagerly so ownership (404) and other HttpErrors map to normal JSON responses.
  const first = await iterator.next();

  const encoder = new TextEncoder();
  const frame = (e: SocraSseEvent) => encoder.encode(`data: ${JSON.stringify(e)}\n\n`);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (!first.done) controller.enqueue(frame(first.value));
        for (;;) {
          const next = await iterator.next();
          if (next.done) break;
          controller.enqueue(frame(next.value));
        }
      } catch (err) {
        console.error("[socra] stream failed", err);
        controller.enqueue(
          frame({
            type: "error",
            code: "socra_unavailable_now",
            message: "Socra is unavailable right now. Your work is saved; you can keep editing, running and submitting.",
          }),
        );
      } finally {
        controller.close();
      }
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});

// Vercel function limit: long model generations need more than the default.
export const maxDuration = 60;
