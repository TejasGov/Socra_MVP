import type { StudyCondition } from "@/generated/prisma/enums";
import { EventSink } from "./events";
import { clamp, S } from "./state";

export type CourseKey = "cse115" | "cse116";

export interface Student {
  n: number;
  key: string;
  id: string;
  name: string;
  ability: number;
  adj: Record<string, number>;
  condition: StudyCondition;
  consented: boolean;
  /** Probability of opening a Socra session after a failed attempt (non-control conditions only). */
  aiProp: number;
  /** How much a Socra conversation raises the chance of fixing the bug in later attempts. */
  receptive: number;
  persist: number;
  leaky: number;
  courses: CourseKey[];
  section: Partial<Record<CourseKey, string>>;
}

export interface Acc {
  drafts: Map<string, Record<string, unknown>>;
  progress: Map<string, Record<string, unknown>>;
  submissions: Record<string, unknown>[];
  answers: Record<string, unknown>[];
  grades: Record<string, unknown>[];
  overrides: Record<string, unknown>[];
  runs: Record<string, unknown>[];
  practiceSessions: Record<string, unknown>[];
  attempts: Record<string, unknown>[];
  aiSessions: Record<string, unknown>[];
  aiRequests: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  decisions: Record<string, unknown>[];
  citations: Record<string, unknown>[];
  escalations: Record<string, unknown>[];
  obs: Record<string, unknown>[];
  evidence: Record<string, unknown>[];
  events: EventSink;
  /** Per student/topic: names of tracked outcomes used for the fallback estimator and practice targeting. */
  topicSkill: Map<string, number>;
}

export function newAcc(): Acc {
  return {
    drafts: new Map(),
    progress: new Map(),
    submissions: [],
    answers: [],
    grades: [],
    overrides: [],
    runs: [],
    practiceSessions: [],
    attempts: [],
    aiSessions: [],
    aiRequests: [],
    messages: [],
    decisions: [],
    citations: [],
    escalations: [],
    obs: [],
    evidence: [],
    events: new EventSink(),
    topicSkill: new Map(),
  };
}

export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function skillFor(st: Student, topics: Array<{ key: string; weight: number }>): number {
  let num = 0;
  let den = 0;
  for (const t of topics) {
    num += (st.adj[t.key] ?? 0) * t.weight;
    den += t.weight;
  }
  return clamp(st.ability + (den ? num / den : 0), 0.02, 0.98);
}

/** Probability of a correct first attempt for skill s on a question of difficulty d (1..5). */
export function pFirst(s: number, d: number): number {
  return sigmoid(5.5 * (s - (0.12 + 0.14 * d)));
}

export function clampAt(t: number, floorMs = 0): Date {
  const cap = S.anchor.getTime() - 5 * 60_000;
  return new Date(Math.max(floorMs, Math.min(t, cap)));
}

export function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}
