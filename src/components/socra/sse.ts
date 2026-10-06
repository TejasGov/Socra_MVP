/**
 * Client for POST /api/socra/sessions/:id/messages (text/event-stream).
 * Frames: data: {"type":"delta","text"} | {"type":"done",...} | {"type":"error","code","message"}
 */

export interface SocraCitation {
  resourceId: string;
  title: string;
  section?: string | null;
}

export interface SocraDone {
  type: "done";
  messageId?: string;
  interventionLevel?: number | null;
  citations?: SocraCitation[];
  limitReached?: boolean;
  policyOutcome?: string | null;
}

export type SocraStreamEvent =
  { type: "delta"; text: string } | SocraDone | { type: "error"; code: string; message: string };

export type StreamOutcome =
  | { kind: "done"; done: SocraDone }
  | { kind: "error"; code: string; message: string; httpStatus?: number }
  | { kind: "aborted" };

function parseFrame(frame: string): SocraStreamEvent | null {
  const data = frame
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data) return null;
  try {
    const parsed = JSON.parse(data) as SocraStreamEvent;
    return parsed && typeof parsed === "object" && "type" in parsed ? parsed : null;
  } catch {
    return null;
  }
}

export async function streamSocraMessage(opts: {
  sessionId: string;
  content: string;
  workspace?: { code: string; language: string | null } | null;
  signal: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<StreamOutcome> {
  let res: Response;
  try {
    res = await fetch(`/api/socra/sessions/${encodeURIComponent(opts.sessionId)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      credentials: "same-origin",
      body: JSON.stringify({
        content: opts.content,
        ...(opts.workspace ? { workspace: opts.workspace } : {}),
      }),
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { kind: "aborted" };
    return { kind: "error", code: "network_error", message: "Network request failed" };
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || !contentType.includes("text/event-stream")) {
    let code = `http_${res.status}`;
    let message = "Request failed";
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code ?? code;
      message = body.error?.message ?? message;
    } catch {
      /* not JSON */
    }
    return { kind: "error", code, message, httpStatus: res.status };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
        const evt = parseFrame(frame);
        if (!evt) continue;
        if (evt.type === "delta") opts.onDelta(evt.text ?? "");
        else if (evt.type === "done") return { kind: "done", done: evt };
        else if (evt.type === "error")
          return { kind: "error", code: evt.code ?? "error", message: evt.message ?? "" };
      }
    }
    const tail = parseFrame(buffer);
    if (tail?.type === "done") return { kind: "done", done: tail };
    if (tail?.type === "error") return { kind: "error", code: tail.code, message: tail.message };
    return { kind: "error", code: "stream_ended", message: "The response ended early" };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { kind: "aborted" };
    if (opts.signal.aborted) return { kind: "aborted" };
    return { kind: "error", code: "stream_failed", message: "The response was interrupted" };
  }
}
