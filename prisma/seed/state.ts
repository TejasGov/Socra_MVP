import { createHash } from "node:crypto";
import type { AssignmentDef, QuestionDef } from "./data/types";
import type { PracticeDef, MisconceptionDef } from "./data/learning";
import type { ResourceDef } from "./data/resources";

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const MIN_MS = 60_000;

/** Fixed PRNG seed for every generated stream (changing it changes all synthetic data). */
export const SEED_CONSTANT = 20261006;

export interface QuestionRef {
  id: string;
  versionId: string;
  version: number;
  def: QuestionDef;
  order: number;
  topicIds: Array<{ id: string; key: string; weight: number }>;
}

export interface AssignmentRef {
  key: string;
  id: string;
  courseKey: "cse115" | "cse116";
  courseId: string;
  def: AssignmentDef;
  versionId: string | null;
  version: number | null;
  policyId: string;
  policyVersion: number;
  questions: QuestionRef[];
  openAt: Date | null;
  dueAt: Date | null;
  closeAt: Date | null;
}

export interface ChunkRef {
  id: string;
  index: number;
  heading: string;
  content: string;
}

export interface ResourceRef {
  id: string;
  def: ResourceDef;
  courseId: string;
  chunks: ChunkRef[];
}

export interface MisconceptionRef {
  id: string;
  key: string;
  courseKey: "cse115" | "cse116";
  topicKey: string;
  topicId: string;
  def: MisconceptionDef;
}

export interface PracticeItemRef {
  id: string;
  courseKey: "cse115" | "cse116";
  topicKey: string;
  topicId: string;
  difficulty: number;
  def: PracticeDef;
  approved: boolean;
  source: "FACULTY" | "CACHED_GENERATED";
}

/** Cross-module registry for the generated seed data (reset on every run). */
export const S = {
  anchor: new Date(0),
  assignments: [] as AssignmentRef[],
  resources: [] as ResourceRef[],
  misconceptions: [] as MisconceptionRef[],
  practiceItems: [] as PracticeItemRef[],
  counts: {} as Record<string, number>,
};

export function resetState(): void {
  S.assignments = [];
  S.resources = [];
  S.misconceptions = [];
  S.practiceItems = [];
  S.counts = {};
}

export function sha(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Deterministic UUID-formatted id derived from a stable key (AnalyticsEvent ids are UUIDs). */
export function detUuid(key: string): string {
  const h = sha(`socra-seed:${key}`);
  const variant = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function count(name: string, n: number): void {
  S.counts[name] = (S.counts[name] ?? 0) + n;
}

type CreateMany = {
  createMany: (args: { data: never[]; skipDuplicates?: boolean }) => Promise<unknown>;
};

/** createMany in chunks (keeps each statement under Postgres' bind-parameter limit). */
export async function bulk<T>(
  delegate: unknown,
  rows: T[],
  opts: { skipDuplicates?: boolean; chunk?: number } = {},
): Promise<void> {
  const d = delegate as CreateMany;
  const size = opts.chunk ?? 500;
  for (let i = 0; i < rows.length; i += size) {
    await d.createMany({
      data: rows.slice(i, i + size) as never[],
      ...(opts.skipDuplicates ? { skipDuplicates: true } : {}),
    });
  }
}

export function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length)] as T;
}

export function between(r: () => number, lo: number, hi: number): number {
  return lo + r() * (hi - lo);
}

export function intBetween(r: () => number, lo: number, hi: number): number {
  return Math.floor(between(r, lo, hi + 1));
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
