import { describe, expect, it } from "vitest";
import {
  parseRosterCsv,
  planRows,
  summarizePlan,
  type ExistingMembership,
  type ExistingUser,
} from "@/server/domain/admin/roster-csv";

const HEADER = "email,name,role,section,courseCode";

function plan(
  csv: string,
  opts: {
    users?: Record<string, ExistingUser>;
    memberships?: Record<string, ExistingMembership>;
  } = {},
) {
  const parsed = parseRosterCsv(csv);
  expect(parsed.fileErrors).toEqual([]);
  return planRows(parsed.rows, {
    courseCode: "CSE 115",
    usersByEmail: new Map(Object.entries(opts.users ?? {})),
    membershipsByUserId: new Map(Object.entries(opts.memberships ?? {})),
  });
}

describe("roster CSV parsing", () => {
  it("reports every missing required column", () => {
    const r = parseRosterCsv("email,name\na@x.edu,A");
    expect(r.rows).toEqual([]);
    expect(r.fileErrors[0]).toContain("role");
    expect(r.fileErrors[0]).toContain("section");
    expect(r.fileErrors[0]).toContain("courseCode");
  });

  it("accepts any header order, case, a BOM and the course_code alias", () => {
    const r = parseRosterCsv(
      "﻿Name,EMAIL,Course_Code,Role,Section\nAda,ada@x.edu,CSE 115,student,A",
    );
    expect(r.fileErrors).toEqual([]);
    expect(r.rows[0]).toMatchObject({
      rowNumber: 2,
      email: "ada@x.edu",
      name: "Ada",
      role: "student",
      section: "A",
      courseCode: "CSE 115",
    });
  });

  it("rejects an empty file body", () => {
    expect(parseRosterCsv(HEADER).fileErrors).toContain("The file has no data rows.");
  });

  it("handles quoted commas in names", () => {
    const r = parseRosterCsv(`${HEADER}\na@x.edu,"Lovelace, Ada",STUDENT,A,CSE 115`);
    expect(r.rows[0]?.name).toBe("Lovelace, Ada");
  });
});

describe("roster row validation", () => {
  it("flags invalid email, role, missing name and wrong course code", () => {
    const rows = plan(
      [
        HEADER,
        "not-an-email,Ada,STUDENT,A,CSE 115",
        "b@x.edu,,STUDENT,A,CSE 115",
        "c@x.edu,Cy,PROFESSOR,A,CSE 115",
        "d@x.edu,Di,STUDENT,A,CSE 999",
      ].join("\n"),
    );
    expect(rows.map((r) => r.status)).toEqual(["INVALID", "INVALID", "INVALID", "INVALID"]);
    expect(rows[0]?.errors.join(" ")).toContain("Email is not valid");
    expect(rows[1]?.errors.join(" ")).toContain("Name is required");
    expect(rows[2]?.errors.join(" ")).toContain("STUDENT, TA or INSTRUCTOR");
    expect(rows[3]?.errors.join(" ")).toContain("does not match the selected course");
  });

  it("plans create / add / update / no-change against existing members", () => {
    const rows = plan(
      [
        HEADER,
        "new@x.edu,New,STUDENT,A,CSE 115",
        "outsider@x.edu,Out,STUDENT,A,CSE 115",
        "member@x.edu,Mem,TA,A,CSE 115",
        "same@x.edu,Same,STUDENT,A,CSE 115",
      ].join("\n"),
      {
        users: {
          "outsider@x.edu": { id: "u_out", name: "Out" },
          "member@x.edu": { id: "u_mem", name: "Mem" },
          "same@x.edu": { id: "u_same", name: "Same" },
        },
        memberships: {
          u_mem: { role: "STUDENT", status: "ACTIVE", sectionCode: "A" },
          u_same: { role: "STUDENT", status: "ACTIVE", sectionCode: "A" },
        },
      },
    );
    expect(rows.map((r) => [r.status, r.action])).toEqual([
      ["VALID", "CREATE_USER"],
      ["VALID", "ADD_MEMBERSHIP"],
      ["VALID", "UPDATE_MEMBERSHIP"],
      ["DUPLICATE", "NONE"],
    ]);
    expect(rows[3]?.errors[0]).toContain("Already an active member");
  });

  it("re-activates a dropped member with the same role as an update", () => {
    const rows = plan(`${HEADER}\nm@x.edu,M,STUDENT,A,CSE 115`, {
      users: { "m@x.edu": { id: "u1", name: "M" } },
      memberships: { u1: { role: "STUDENT", status: "DROPPED", sectionCode: "A" } },
    });
    expect(rows[0]).toMatchObject({ status: "VALID", action: "UPDATE_MEMBERSHIP" });
  });
});

describe("roster duplicate detection within the file", () => {
  it("marks the second occurrence (case-insensitive email) as a duplicate and keeps the first", () => {
    const rows = plan(
      [HEADER, "Dup@x.edu,One,STUDENT,A,CSE 115", "dup@X.edu,Two,TA,B,CSE 115"].join("\n"),
    );
    expect(rows[0]).toMatchObject({ status: "VALID", action: "CREATE_USER", email: "dup@x.edu" });
    expect(rows[1]).toMatchObject({ status: "DUPLICATE", action: "NONE" });
    expect(rows[1]?.errors[0]).toContain("Duplicate of row 2");
  });

  it("does not let an invalid first row shadow a later valid row", () => {
    const rows = plan(
      [HEADER, "x@x.edu,,STUDENT,A,CSE 115", "x@x.edu,Real,STUDENT,A,CSE 115"].join("\n"),
    );
    expect(rows.map((r) => r.status)).toEqual(["INVALID", "VALID"]);
  });

  it("summarizes the plan", () => {
    const rows = plan(
      [
        HEADER,
        "a@x.edu,A,STUDENT,A,CSE 115",
        "a@x.edu,A,STUDENT,A,CSE 115",
        "bad,B,STUDENT,A,CSE 115",
      ].join("\n"),
    );
    expect(summarizePlan(rows)).toMatchObject({
      total: 3,
      create: 1,
      duplicate: 1,
      invalid: 1,
      valid: 1,
    });
  });
});
