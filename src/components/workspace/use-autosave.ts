"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiJson, safeStorage } from "./api";
import type { DraftDto, SaveStatus } from "./types";

/**
 * Draft autosave (PRD §10.10, TASK §31):
 *  - debounced PUT /api/drafts with optimistic concurrency (baseVersion)
 *  - localStorage recovery buffer, restored on load when newer than the server copy
 *  - retry with exponential backoff while offline; never overwrites a newer server version (409 → conflict)
 */

const DEBOUNCE_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

interface Buffer {
  content: string;
  baseVersion: number;
  updatedAt: number;
}

export interface Conflict {
  serverVersion: number;
  serverContent: string;
}

export interface AutosaveState {
  content: string;
  status: SaveStatus;
  savedAt: Date | null;
  conflict: Conflict | null;
  /** True when the editor was restored from this device's recovery buffer. */
  restoredFromDevice: boolean;
  setContent: (next: string) => void;
  /** Resolve a 409: keep the local copy (overwrites the newer server version deliberately). */
  keepMine: () => void;
  /** Resolve a 409: discard local changes and load the saved server version. */
  acceptSaved: () => void;
  /** Save immediately (used before submit). Resolves when the save attempt settles. */
  flush: () => Promise<void>;
}

function bufferKey(assignmentId: string, questionId: string) {
  return `socra:draft:${assignmentId}:${questionId}`;
}

function readBuffer(key: string): Buffer | null {
  const raw = safeStorage.get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Buffer>;
    if (typeof parsed.content !== "string" || typeof parsed.updatedAt !== "number") return null;
    return {
      content: parsed.content,
      baseVersion: typeof parsed.baseVersion === "number" ? parsed.baseVersion : 0,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

function parseConflict(body: unknown): Conflict | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const candidates: Array<Record<string, unknown>> = [b];
  if (b.error && typeof b.error === "object") {
    const e = b.error as Record<string, unknown>;
    candidates.push(e);
    if (e.details && typeof e.details === "object")
      candidates.push(e.details as Record<string, unknown>);
  }
  for (const c of candidates) {
    if (typeof c.serverVersion === "number" && typeof c.content === "string") {
      return { serverVersion: c.serverVersion, serverContent: c.content };
    }
  }
  return null;
}

export function useAutosave(opts: {
  assignmentId: string;
  questionId: string;
  initialDraft: DraftDto | null;
  starterContent: string;
  readOnly?: boolean;
}): AutosaveState {
  const { assignmentId, questionId, initialDraft, starterContent, readOnly } = opts;
  const key = bufferKey(assignmentId, questionId);

  const [content, setContentState] = useState(initialDraft?.content ?? starterContent);
  const [status, setStatus] = useState<SaveStatus>(initialDraft ? "saved" : "idle");
  const [savedAt, setSavedAt] = useState<Date | null>(
    initialDraft ? new Date(initialDraft.updatedAt) : null,
  );
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [restoredFromDevice, setRestored] = useState(false);

  const contentRef = useRef(content);
  const versionRef = useRef(initialDraft?.version ?? 0);
  const dirtyRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backoffRef = useRef(2000);
  const conflictRef = useRef<Conflict | null>(null);
  const mountedRef = useRef(true);
  const saveRef = useRef<() => Promise<void>>(async () => {});

  const writeBuffer = useCallback(
    (text: string) => {
      safeStorage.set(
        key,
        JSON.stringify({ content: text, baseVersion: versionRef.current, updatedAt: Date.now() }),
      );
    },
    [key],
  );

  const save = useCallback(async (): Promise<void> => {
    if (readOnly || conflictRef.current) return;
    if (inFlightRef.current) {
      await inFlightRef.current;
      if (!dirtyRef.current) return;
    }
    if (!dirtyRef.current) return;
    const run = (async () => {
      const sending = contentRef.current;
      dirtyRef.current = false;
      setStatus("saving");
      const res = await apiJson<{ version: number; savedAt: string }>("/api/drafts", {
        method: "PUT",
        body: { assignmentId, questionId, content: sending, baseVersion: versionRef.current },
      });
      if (!mountedRef.current) return;
      if (res.ok) {
        versionRef.current = res.data.version;
        backoffRef.current = 2000;
        setSavedAt(res.data.savedAt ? new Date(res.data.savedAt) : new Date());
        if (contentRef.current === sending) {
          safeStorage.remove(key);
          setStatus("saved");
        } else {
          // Edits arrived while saving; keep the buffer current and save again.
          writeBuffer(contentRef.current);
          dirtyRef.current = true;
        }
        return;
      }
      if (res.status === 409) {
        const c = parseConflict(res.body);
        dirtyRef.current = true;
        if (c) {
          conflictRef.current = c;
          setConflict(c);
          setStatus("conflict");
          return;
        }
      }
      dirtyRef.current = true;
      if (res.status === 0 || res.status >= 500 || res.status === 429) {
        setStatus("offline");
        const delay = backoffRef.current;
        backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
        if (retryRef.current) clearTimeout(retryRef.current);
        retryRef.current = setTimeout(() => void saveRef.current(), delay);
      } else {
        // 4xx (e.g. assignment closed): keep the device copy, stop retrying.
        setStatus("error");
      }
    })();
    inFlightRef.current = run;
    try {
      await run;
    } finally {
      inFlightRef.current = null;
    }
    if (dirtyRef.current && !conflictRef.current && mountedRef.current) {
      // Another edit happened during the save; schedule the next one through the debounce path.
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void saveRef.current(), DEBOUNCE_MS);
    }
  }, [assignmentId, questionId, key, readOnly, writeBuffer]);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Restore from the device buffer when it is newer than the server copy.
  useEffect(() => {
    mountedRef.current = true;
    const buf = readBuffer(key);
    const serverTime = initialDraft ? new Date(initialDraft.updatedAt).getTime() : 0;
    const serverContent = initialDraft?.content ?? starterContent;
    if (buf && buf.updatedAt > serverTime && buf.content !== serverContent && !readOnly) {
      contentRef.current = buf.content;
      // localStorage is an external system that is only readable after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContentState(buf.content);
      setRestored(true);
      // Save with the version the buffer was based on: if the server moved on, the 409 path asks the student.
      versionRef.current = buf.baseVersion || versionRef.current;
      dirtyRef.current = true;
      void save();
    } else if (buf) {
      safeStorage.remove(key);
    }
    const onOnline = () => {
      if (dirtyRef.current) void save();
    };
    window.addEventListener("online", onOnline);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("online", onOnline);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per question mount
  }, [key]);

  const setContent = useCallback(
    (next: string) => {
      if (readOnly) return;
      contentRef.current = next;
      setContentState(next);
      dirtyRef.current = true;
      writeBuffer(next);
      if (conflictRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void save(), DEBOUNCE_MS);
    },
    [readOnly, save, writeBuffer],
  );

  const keepMine = useCallback(() => {
    const c = conflictRef.current;
    if (!c) return;
    versionRef.current = c.serverVersion;
    conflictRef.current = null;
    setConflict(null);
    dirtyRef.current = true;
    writeBuffer(contentRef.current);
    void save();
  }, [save, writeBuffer]);

  const acceptSaved = useCallback(() => {
    const c = conflictRef.current;
    if (!c) return;
    versionRef.current = c.serverVersion;
    conflictRef.current = null;
    contentRef.current = c.serverContent;
    dirtyRef.current = false;
    setConflict(null);
    setContentState(c.serverContent);
    safeStorage.remove(key);
    setStatus("saved");
  }, [key]);

  const flush = useCallback(async () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    await save();
  }, [save]);

  return {
    content,
    status,
    savedAt,
    conflict,
    restoredFromDevice,
    setContent,
    keepMine,
    acceptSaved,
    flush,
  };
}
