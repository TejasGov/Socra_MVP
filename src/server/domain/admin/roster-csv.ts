import Papa from "papaparse";

/**
 * Roster CSV parsing and row planning (PRD §32). Pure functions: no DB access, unit-tested.
 * Required columns: email, name, role, section, courseCode (header order is free, case-insensitive).
 */

export const ROSTER_COLUMNS = ["email", "name", "role", "section", "courseCode"] as const;
export const ROSTER_MAX_ROWS = 5000;
export const ROSTER_MAX_BYTES = 2_000_000;

export type RosterRole = "STUDENT" | "TA" | "INSTRUCTOR";
export type PlannedStatus = "VALID" | "DUPLICATE" | "INVALID";
export type PlannedAction = "CREATE_USER" | "ADD_MEMBERSHIP" | "UPDATE_MEMBERSHIP" | "NONE";

export interface RawRosterRow {
  rowNumber: number;
  email: string;
  name: string;
  role: string;
  section: string;
  courseCode: string;
}

export interface ParsedRoster {
  rows: RawRosterRow[];
  /** File-level problems (missing columns, too many rows). Row-level problems are in planRows. */
  fileErrors: string[];
}

const HEADER_ALIASES: Record<string, (typeof ROSTER_COLUMNS)[number]> = {
  email: "email",
  name: "name",
  role: "role",
  section: "section",
  coursecode: "courseCode",
  course_code: "courseCode",
  "course code": "courseCode",
};

export function parseRosterCsv(text: string): ParsedRoster {
  const fileErrors: string[] = [];
  if (text.length > ROSTER_MAX_BYTES) {
    return { rows: [], fileErrors: [`File is larger than ${ROSTER_MAX_BYTES} bytes.`] };
  }
  const clean = text.replace(/^﻿/, "");
  const result = Papa.parse<Record<string, string>>(clean, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? h.trim(),
  });

  const headers = result.meta.fields ?? [];
  const missing = ROSTER_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    fileErrors.push(`Missing required column(s): ${missing.join(", ")}.`);
  }
  for (const err of result.errors) {
    if (err.code === "TooFewFields" || err.code === "TooManyFields") continue; // reported per row
    fileErrors.push(
      `CSV parse error${err.row !== undefined ? ` near row ${err.row + 2}` : ""}: ${err.message}`,
    );
  }
  if (result.data.length > ROSTER_MAX_ROWS) {
    fileErrors.push(`Too many rows (${result.data.length}); the limit is ${ROSTER_MAX_ROWS}.`);
    return { rows: [], fileErrors };
  }
  if (missing.length > 0) return { rows: [], fileErrors };

  const rows = result.data.map((r, i) => ({
    rowNumber: i + 2, // 1-based, header is row 1
    email: (r.email ?? "").trim(),
    name: (r.name ?? "").trim(),
    role: (r.role ?? "").trim(),
    section: (r.section ?? "").trim(),
    courseCode: (r.courseCode ?? "").trim(),
  }));
  if (rows.length === 0) fileErrors.push("The file has no data rows.");
  return { rows, fileErrors };
}

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseRosterRole(value: string): RosterRole | null {
  const v = value.trim().toUpperCase();
  if (v === "STUDENT" || v === "TA" || v === "INSTRUCTOR") return v;
  return null;
}

export interface ExistingUser {
  id: string;
  name: string;
}
export interface ExistingMembership {
  role: RosterRole;
  status: "ACTIVE" | "DROPPED";
  sectionCode: string | null;
}

export interface PlanContext {
  /** Code of the course the import targets (rows must match it). */
  courseCode: string;
  /** Lower-cased email -> existing user. */
  usersByEmail: ReadonlyMap<string, ExistingUser>;
  /** userId -> existing membership in the target course. */
  membershipsByUserId: ReadonlyMap<string, ExistingMembership>;
}

export interface PlannedRow {
  rowNumber: number;
  email: string;
  name: string;
  role: RosterRole | null;
  sectionCode: string | null;
  status: PlannedStatus;
  action: PlannedAction;
  errors: string[];
  userId: string | null;
}

/** Validate each row and decide create/update/duplicate/error. Duplicates inside the file keep the first occurrence. */
export function planRows(rows: readonly RawRosterRow[], ctx: PlanContext): PlannedRow[] {
  const seen = new Map<string, number>();
  const wantCode = ctx.courseCode.trim().toLowerCase();
  return rows.map((raw): PlannedRow => {
    const errors: string[] = [];
    const email = normalizeEmail(raw.email);
    const role = parseRosterRole(raw.role);
    const sectionCode = raw.section.trim() === "" ? null : raw.section.trim();

    if (!email) errors.push("Email is required.");
    else if (!EMAIL_RE.test(email)) errors.push("Email is not valid.");
    if (!raw.name) errors.push("Name is required.");
    else if (raw.name.length > 200) errors.push("Name is longer than 200 characters.");
    if (!raw.role) errors.push("Role is required.");
    else if (!role) errors.push(`Role "${raw.role}" must be STUDENT, TA or INSTRUCTOR.`);
    if (!raw.courseCode) errors.push("courseCode is required.");
    else if (raw.courseCode.trim().toLowerCase() !== wantCode) {
      errors.push(
        `courseCode "${raw.courseCode}" does not match the selected course (${ctx.courseCode}).`,
      );
    }
    if (sectionCode && sectionCode.length > 40)
      errors.push("Section is longer than 40 characters.");

    const base = { rowNumber: raw.rowNumber, email, name: raw.name, role, sectionCode };
    if (errors.length > 0) {
      return { ...base, status: "INVALID", action: "NONE", errors, userId: null };
    }

    const firstRow = seen.get(email);
    if (firstRow !== undefined) {
      return {
        ...base,
        status: "DUPLICATE",
        action: "NONE",
        errors: [`Duplicate of row ${firstRow} in this file; this row is skipped.`],
        userId: null,
      };
    }
    seen.set(email, raw.rowNumber);

    const user = ctx.usersByEmail.get(email);
    if (!user) {
      return { ...base, status: "VALID", action: "CREATE_USER", errors: [], userId: null };
    }
    const membership = ctx.membershipsByUserId.get(user.id);
    if (!membership) {
      return { ...base, status: "VALID", action: "ADD_MEMBERSHIP", errors: [], userId: user.id };
    }
    const same =
      membership.status === "ACTIVE" &&
      membership.role === role &&
      (membership.sectionCode ?? null) === sectionCode;
    if (same) {
      return {
        ...base,
        status: "DUPLICATE",
        action: "NONE",
        errors: ["Already an active member with the same role and section."],
        userId: user.id,
      };
    }
    return { ...base, status: "VALID", action: "UPDATE_MEMBERSHIP", errors: [], userId: user.id };
  });
}

export function summarizePlan(planned: readonly PlannedRow[]) {
  const count = (pred: (r: PlannedRow) => boolean) => planned.filter(pred).length;
  return {
    total: planned.length,
    create: count((r) => r.action === "CREATE_USER"),
    addMembership: count((r) => r.action === "ADD_MEMBERSHIP"),
    update: count((r) => r.action === "UPDATE_MEMBERSHIP"),
    duplicate: count((r) => r.status === "DUPLICATE"),
    invalid: count((r) => r.status === "INVALID"),
    valid: count((r) => r.status === "VALID"),
  };
}
