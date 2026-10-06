"use client";

import { buttonClasses } from "@/components/ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Lock, Send, Square } from "lucide-react";
import { Markdown } from "@/components/workspace/markdown";
import { apiJson } from "@/components/workspace/api";
import { GuidanceDepth, guidanceLabel } from "./guidance-depth";
import { streamSocraMessage, type SocraCitation } from "./sse";

export type SocraPanelMode = "PROTECTED_ASSESSMENT" | "POST_ASSESSMENT_REVIEW" | "PRACTICE";

interface Turn {
  id: string;
  role: "user" | "assistant";
  content: string;
  level: number | null;
  citations: SocraCitation[];
  policyOutcome: string | null;
  state: "streaming" | "done" | "stopped" | "failed";
}

const LIMIT_MESSAGE =
  "Socra has provided the maximum guided assistance available for this activity. Please take your current work and questions to your TA, office hours, or instructor.";
const UNAVAILABLE_MESSAGE = "Socra is unavailable. You can keep working and submit normally.";
const UNAVAILABLE_PRACTICE = "Socra is unavailable. You can keep answering practice questions.";

const MODE_COPY: Record<SocraPanelMode, { name: string; statement: string; placeholder: string }> =
  {
    PROTECTED_ASSESSMENT: {
      name: "Protected learning mode",
      statement:
        "Socra can help you reason, debug, and understand concepts, but it will not complete the protected part of this assignment for you.",
      placeholder: "Explain your next reasoning step, or describe where you are stuck…",
    },
    POST_ASSESSMENT_REVIEW: {
      name: "Review mode",
      statement:
        "This assignment is closed. Socra can now explain complete solutions and help you compare approaches.",
      placeholder: "Ask about the solution, your approach, or a line you want explained…",
    },
    PRACTICE: {
      name: "Practice mode",
      statement:
        "Use Socra as a tutor. Ask for explanations, examples, or complete walkthroughs when you need them.",
      placeholder: "Ask about this question or the concept behind it…",
    },
  };

function isLimitCode(code: string) {
  const c = code.toLowerCase();
  return c.includes("limit") || c.includes("budget");
}

function citationText(c: SocraCitation) {
  if (!c.section) return c.title;
  // Sections sometimes repeat the resource title ("Lecture 9 > Loops"); show it once.
  const parts = c.section.split(/\s*[>›]\s*/).filter((p) => p && p !== c.title);
  return [c.title, ...parts].join(" › ");
}

/** Parse GET /api/socra/sessions/:id defensively: { messages } or { session: { messages } }. */
function parseHistory(body: unknown): Turn[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  const raw =
    (Array.isArray(b.messages) && b.messages) ||
    (b.session &&
      typeof b.session === "object" &&
      Array.isArray((b.session as Record<string, unknown>).messages) &&
      ((b.session as Record<string, unknown>).messages as unknown[])) ||
    [];
  const turns: Turn[] = [];
  for (const m of raw as Array<Record<string, unknown>>) {
    const role = String(m.role ?? "").toLowerCase();
    if (role !== "user" && role !== "assistant") continue;
    const meta = (m.metadata && typeof m.metadata === "object" ? m.metadata : {}) as Record<
      string,
      unknown
    >;
    const citations = (Array.isArray(m.citations) ? m.citations : meta.citations) as
      SocraCitation[] | undefined;
    turns.push({
      id: String(m.id ?? Math.random()),
      role,
      content: String(m.content ?? ""),
      level: typeof m.interventionLevel === "number" ? m.interventionLevel : null,
      citations: Array.isArray(citations) ? citations : [],
      policyOutcome:
        typeof m.policyOutcome === "string"
          ? m.policyOutcome
          : typeof meta.policyOutcome === "string"
            ? meta.policyOutcome
            : null,
      state: "done",
    });
  }
  return turns;
}

export interface SocraPanelProps {
  mode: SocraPanelMode;
  /** Body for POST /api/socra/sessions. */
  sessionRequest: { assignmentId?: string; questionId?: string; practiceSessionId?: string };
  /** Read at send time: the current editor content, attached automatically. */
  getWorkspace?: () => { code: string; language: string | null } | null;
  /** What Socra can see, e.g. ["the prompt", "your code", "your last run", "public test results"]. */
  contextItems: string[];
  /** Create the session only when the panel is shown. */
  active?: boolean;
  /** False when Socra is turned off for this course. */
  available?: boolean;
  /** Question type (CODING, SHORT_ANSWER, ESSAY, MULTIPLE_CHOICE); drives non-code copy. */
  questionType?: string;
  /** Optional label shown above the log, e.g. the question title. */
  scopeLabel?: string;
  className?: string;
}

export function SocraPanel({
  mode,
  sessionRequest,
  getWorkspace,
  contextItems,
  active = true,
  available = true,
  scopeLabel,
  questionType,
  className = "",
}: SocraPanelProps) {
  const isCodeQuestion = !questionType || questionType === "CODING";
  const copy = MODE_COPY[mode];
  const inputId = useId();
  const helpId = useId();
  const headingId = useId();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionState, setSessionState] = useState<"idle" | "creating" | "ready" | "failed">(
    "idle",
  );
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [lastFailedContent, setLastFailedContent] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [policySummary, setPolicySummary] = useState<string | null>(null);
  const [levelCap, setLevelCap] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const reqKey = JSON.stringify(sessionRequest);

  const creatingRef = useRef<Promise<string | null> | null>(null);

  const createSession = useCallback((): Promise<string | null> => {
    if (creatingRef.current) return creatingRef.current;
    const p = (async () => {
      const res = await apiJson<{
        sessionId: string;
        mode?: string;
        policySummary?: string;
        maxInterventionLevel?: number | null;
      }>("/api/socra/sessions", {
        method: "POST",
        body: mode === "PRACTICE" ? { ...JSON.parse(reqKey), mode } : JSON.parse(reqKey),
      });
      if (!res.ok || !res.data?.sessionId) {
        setSessionState("failed");
        if (isLimitCode(res.ok ? "" : res.error.code)) setLimitReached(true);
        else setFailure(mode === "PRACTICE" ? UNAVAILABLE_PRACTICE : UNAVAILABLE_MESSAGE);
        return null;
      }
      setSessionId(res.data.sessionId);
      setPolicySummary(res.data.policySummary ?? null);
      setLevelCap(
        typeof res.data.maxInterventionLevel === "number" ? res.data.maxInterventionLevel : null,
      );
      setSessionState("ready");
      setFailure(null);
      const hist = await apiJson<unknown>(
        `/api/socra/sessions/${encodeURIComponent(res.data.sessionId)}`,
      );
      if (hist.ok) {
        const restored = parseHistory(hist.data);
        if (restored.length > 0) setTurns((cur) => (cur.length === 0 ? restored : cur));
        const status =
          hist.data && typeof hist.data === "object"
            ? String(
                (hist.data as Record<string, unknown>).status ??
                  ((hist.data as Record<string, { status?: string }>).session?.status || ""),
              )
            : "";
        if (status === "LIMIT_REACHED") setLimitReached(true);
      }
      return res.data.sessionId;
    })();
    creatingRef.current = p;
    void p.then((id) => {
      if (!id) creatingRef.current = null;
    });
    return p;
  }, [reqKey, mode]);

  useEffect(() => {
    if (active && available && sessionState === "idle") void createSession();
  }, [active, available, sessionState, createSession]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streaming || limitReached) return;
      setFailure(null);
      setLastFailedContent(null);
      let sid = sessionId;
      if (!sid) {
        sid = await createSession();
        if (!sid) {
          setLastFailedContent(content);
          return;
        }
      }
      const userTurn: Turn = {
        id: `u-${Date.now()}`,
        role: "user",
        content,
        level: null,
        citations: [],
        policyOutcome: null,
        state: "done",
      };
      const replyId = `a-${Date.now()}`;
      setTurns((t) => [
        ...t,
        userTurn,
        {
          id: replyId,
          role: "assistant",
          content: "",
          level: null,
          citations: [],
          policyOutcome: null,
          state: "streaming",
        },
      ]);
      setDraft("");
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const outcome = await streamSocraMessage({
        sessionId: sid,
        content,
        workspace: getWorkspace?.() ?? null,
        signal: controller.signal,
        onDelta: (delta) =>
          setTurns((t) =>
            t.map((turn) =>
              turn.id === replyId ? { ...turn, content: turn.content + delta } : turn,
            ),
          ),
      });
      abortRef.current = null;
      setStreaming(false);
      if (outcome.kind === "done") {
        const d = outcome.done;
        setTurns((t) =>
          t.map((turn) =>
            turn.id === replyId
              ? {
                  ...turn,
                  id: d.messageId ?? turn.id,
                  level: typeof d.interventionLevel === "number" ? d.interventionLevel : null,
                  citations: Array.isArray(d.citations) ? d.citations : [],
                  policyOutcome: d.policyOutcome ?? null,
                  state: "done",
                }
              : turn,
          ),
        );
        if (d.limitReached) setLimitReached(true);
      } else if (outcome.kind === "aborted") {
        setTurns((t) =>
          t
            .map((turn) => (turn.id === replyId ? { ...turn, state: "stopped" as const } : turn))
            .filter((turn) => !(turn.id === replyId && turn.content === "")),
        );
      } else {
        // Remove the empty reply; keep the student's message so they can retry.
        setTurns((t) =>
          t
            .filter((turn) => !(turn.id === replyId && turn.content === ""))
            .map((turn) => (turn.id === replyId ? { ...turn, state: "failed" as const } : turn)),
        );
        if (isLimitCode(outcome.code) || outcome.httpStatus === 429) {
          setLimitReached(true);
        } else {
          setFailure(mode === "PRACTICE" ? UNAVAILABLE_PRACTICE : UNAVAILABLE_MESSAGE);
          setLastFailedContent(content);
          setTurns((t) => t.filter((turn) => turn.id !== userTurn.id));
          setDraft(content);
        }
      }
    },
    [streaming, limitReached, sessionId, createSession, getWorkspace, mode],
  );

  const retry = useCallback(() => {
    setFailure(null);
    if (!sessionId) {
      void createSession();
      return;
    }
    if (lastFailedContent) void send(lastFailedContent);
  }, [sessionId, lastFailedContent, send, createSession]);

  const assistantLevels = turns.filter((t) => t.role === "assistant" && t.level !== null);
  const maxLevel = assistantLevels.reduce<number | null>(
    (m, t) => (m === null || (t.level as number) > m ? (t.level as number) : m),
    null,
  );

  const lastTurn = turns[turns.length - 1];
  const studentAnswering = (i: number) => {
    // A student turn that directly follows a Socra question reads as "Your reasoning".
    const prev = turns[i - 1];
    return prev?.role === "assistant" && /\?\s*$/.test(prev.content.trim());
  };

  return (
    <section
      aria-labelledby={headingId}
      className={`border-border bg-surface flex min-h-0 flex-col rounded-lg border ${className}`}
    >
      <header className="border-border border-b px-4 py-3">
        <h2 id={headingId} className="text-fg text-sm font-semibold">
          Socra <span className="text-fg-muted font-normal">· {copy.name}</span>
        </h2>
        <p className="text-fg-muted mt-1 text-xs">{policySummary ?? copy.statement}</p>
        {mode === "PROTECTED_ASSESSMENT" && levelCap !== null ? (
          <div className="mt-2">
            <GuidanceDepth deepest={maxLevel} cap={levelCap} />
          </div>
        ) : null}
      </header>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Socra conversation"
        className="min-h-40 flex-1 space-y-3 overflow-y-auto px-4 py-3"
      >
        {scopeLabel ? <p className="text-fg-subtle text-xs">{scopeLabel}</p> : null}
        {!available ? (
          <p className="text-fg-muted text-sm">
            Socra is turned off for this course. You can keep working and submit normally.
          </p>
        ) : turns.length === 0 ? (
          <p className="text-fg-muted text-sm">
            {sessionState === "idle" && active
              ? "Opening a Socra session…"
              : mode === "POST_ASSESSMENT_REVIEW"
                ? "Ask Socra to walk through the solution, explain a line, or compare it with your submission."
                : mode === "PRACTICE"
                  ? "Ask about the current question, or ask for a worked example of the concept."
                  : !isCodeQuestion
                    ? "Say which option you are unsure about and why, or explain your reasoning so far."
                    : "Describe what you expect your code to do and where it differs. Socra reads your current code with each message, so you don't need to paste it."}
          </p>
        ) : (
          turns.map((turn, i) =>
            turn.role === "user" ? (
              <article
                key={turn.id}
                aria-label={studentAnswering(i) ? "Your reasoning" : "You"}
                data-testid={active ? "socra-message" : undefined}
                data-role="user"
                className="px-3 py-2"
              >
                <p className="text-fg-muted mb-1 text-xs font-medium">
                  {studentAnswering(i) ? "Your reasoning" : "You"}
                </p>
                <p className="text-fg text-sm whitespace-pre-wrap">{turn.content}</p>
              </article>
            ) : (
              <article
                key={turn.id}
                aria-label="Socra"
                aria-busy={turn.state === "streaming"}
                data-testid={active ? "socra-message" : undefined}
                data-role="assistant"
                className="border-accent bg-accent-subtle border-l-2 px-3 py-2"
              >
                <p className="text-accent mb-1 flex items-center gap-1.5 text-xs font-medium">
                  <span>Socra</span>
                  {turn.level !== null ? (
                    <span className="text-fg-muted font-normal">
                      · Level {turn.level}, {guidanceLabel(turn.level)}
                    </span>
                  ) : null}
                </p>
                {turn.policyOutcome === "BLOCK" || turn.policyOutcome === "REVISE" ? (
                  <p className="text-fg-muted mb-1 flex items-center gap-1 text-xs">
                    <Lock size={12} strokeWidth={1.75} aria-hidden="true" />
                    Protected assignment policy: complete solutions are not provided.
                  </p>
                ) : null}
                {turn.content ? (
                  <Markdown noCopyCode={mode === "PROTECTED_ASSESSMENT"} breaks>
                    {turn.content}
                  </Markdown>
                ) : turn.state === "streaming" ? (
                  <p className="text-fg-muted text-sm">Socra is reading your work…</p>
                ) : null}
                {turn.state === "stopped" ? (
                  <p className="text-fg-subtle mt-1 text-xs">Stopped before the reply finished.</p>
                ) : null}
                {turn.citations.length > 0 ? (
                  <div className="border-border mt-2 border-t pt-1.5">
                    <p className="text-fg-muted text-xs">Course material used:</p>
                    <ul className="text-fg mt-0.5 text-xs">
                      {turn.citations.map((c, ci) => (
                        <li key={`${c.resourceId}-${ci}`}>{citationText(c)}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            ),
          )
        )}
        {limitReached ? (
          <p role="status" className="border-border-strong text-fg border-l-2 px-3 py-2 text-sm">
            {LIMIT_MESSAGE}
          </p>
        ) : null}
      </div>

      {failure ? (
        <div
          role="alert"
          className="border-border bg-warning-bg flex items-center justify-between gap-3 border-t px-4 py-2"
        >
          <p className="text-warning text-sm">{failure}</p>
          <button
            type="button"
            onClick={retry}
            className={buttonClasses("secondary", "md", "shrink-0")}
          >
            Retry
          </button>
        </div>
      ) : null}

      <div className="border-border border-t px-4 py-3">
        <p className="text-fg-subtle mb-2 text-xs">
          Socra can see {contextItems.length ? joinList(contextItems) : "this conversation"}.
        </p>
        {!limitReached ? (
          <div className="mb-2">
            <button
              type="button"
              disabled={streaming || !available}
              onClick={() =>
                void send(
                  mode === "POST_ASSESSMENT_REVIEW"
                    ? "Explain the full solution step by step, and compare it with my submitted code."
                    : "Give me a hint for my next step, without showing the solution.",
                )
              }
              className={buttonClasses("secondary", "md")}
            >
              {mode === "POST_ASSESSMENT_REVIEW" ? "Explain the full solution" : "Ask for a hint"}
            </button>
          </div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(draft);
          }}
        >
          <label htmlFor={inputId} className="text-fg mb-1 block text-sm font-medium">
            Message to Socra
          </label>
          <textarea
            id={inputId}
            data-testid={active ? "socra-input" : undefined}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(draft);
              }
            }}
            rows={3}
            disabled={!available || limitReached}
            placeholder={copy.placeholder}
            aria-describedby={helpId}
            className="border-border-input bg-surface text-fg placeholder:text-fg-subtle disabled:bg-surface-2 block w-full resize-y rounded-sm border px-2.5 py-2 text-sm"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p id={helpId} className="text-fg-subtle text-xs">
              Enter sends. Shift+Enter adds a line.
            </p>
            {streaming ? (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className={buttonClasses("secondary", "md")}
              >
                <Square size={14} strokeWidth={1.75} aria-hidden="true" />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                data-testid={active ? "socra-send" : undefined}
                aria-label="Send to Socra"
                disabled={!available || limitReached || draft.trim() === ""}
                className={buttonClasses("primary", "md")}
              >
                <Send size={14} strokeWidth={1.75} aria-hidden="true" />
                Send
              </button>
            )}
          </div>
        </form>
        {lastTurn?.state === "streaming" ? (
          <span className="sr-only">Socra is replying</span>
        ) : null}
      </div>
    </section>
  );
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
