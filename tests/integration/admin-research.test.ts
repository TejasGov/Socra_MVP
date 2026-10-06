import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Must run before env() is first read (imports are hoisted, so use vi.hoisted).
const storageDir = vi.hoisted(() => {
  const dir = `${process.env.TEMP ?? "/tmp"}/socra-itest-${Date.now()}`;
  process.env.LOCAL_STORAGE_DIR = dir;
  return dir;
});

import { loadPrincipal, type CurrentUser } from "@/server/auth/current-user";
import { AuthError } from "@/server/auth/rbac";
import { disconnectPrisma, prisma } from "@/server/db";
import { applyRosterImport, previewRosterImport } from "@/server/domain/admin/roster";
import { updateFlag } from "@/server/domain/admin/flags";
import { createResearchExport, getResearchExportDownload } from "@/server/domain/research/export";
import { changeParticipantCondition } from "@/server/domain/research/participants";
import { writeEvent, pseudonymFor } from "@/server/events";
import { HttpError } from "@/server/http";

const RUN = randomUUID().slice(0, 8);
const mail = (n: string) => `${n}-${RUN}@itest.socra.local`;
const courseId = `itest_ar_course_${RUN}`;
const assignmentId = `itest_ar_asg_${RUN}`;

const ids: Record<string, string> = {};
let researcher: CurrentUser;
let sysadmin: CurrentUser;
let instructor: CurrentUser;
let student: CurrentUser;

async function mkUser(
  key: string,
  roles: Array<"STUDENT" | "INSTRUCTOR" | "RESEARCH_ADMIN" | "SYSTEM_ADMIN">,
  name: string,
) {
  const u = await prisma.user.create({ data: { email: mail(key), name, roles } });
  ids[key] = u.id;
  return u;
}

beforeAll(async () => {
  await prisma.course.create({
    data: {
      id: courseId,
      code: `ITEST ${RUN}`,
      title: "Admin research test",
      term: "T",
      languages: ["PYTHON"],
    },
  });
  await mkUser("research", ["RESEARCH_ADMIN"], "Rita Researcher");
  await mkUser("sysadmin", ["SYSTEM_ADMIN"], "Sam Sysadmin");
  await mkUser("instructor", ["INSTRUCTOR"], "Ingrid Instructor");
  await mkUser("student", ["STUDENT"], "Alice Wonderland");
  await mkUser("consent", ["STUDENT"], "Bob Builder");
  await mkUser("declined", ["STUDENT"], "Carl Declined");
  await prisma.courseMembership.createMany({
    data: [
      { userId: ids.instructor!, courseId, role: "INSTRUCTOR" },
      { userId: ids.student!, courseId, role: "STUDENT" },
      { userId: ids.consent!, courseId, role: "STUDENT" },
      { userId: ids.declined!, courseId, role: "STUDENT" },
    ],
  });
  await prisma.studyParticipant.createMany({
    data: [
      {
        userId: ids.student!,
        courseId,
        pseudonymousId: pseudonymFor(ids.student!),
        condition: "SOCRATIC_AI",
        consentStatus: "CONSENTED",
      },
      {
        userId: ids.consent!,
        courseId,
        pseudonymousId: pseudonymFor(ids.consent!),
        condition: "CONTROL",
        consentStatus: "CONSENTED",
      },
      {
        userId: ids.declined!,
        courseId,
        pseudonymousId: pseudonymFor(ids.declined!),
        condition: "CONTROL",
        consentStatus: "DECLINED",
      },
    ],
  });
  // Events carry stray metadata that must never be exported.
  for (const [who, key] of [
    ["student", "alice"],
    ["consent", "bob"],
    ["declined", "carl"],
  ] as const) {
    await prisma.$transaction((tx) =>
      writeEvent(tx, {
        eventName: "socra_response_completed",
        actorId: ids[who]!,
        courseId,
        assignmentId,
        assignmentVersion: 1,
        idempotencyKey: `itest-ar:${RUN}:${key}`,
        metadata: {
          mode: "PROTECTED_ASSESSMENT",
          messageId: "m1",
          aiRequestId: "r1",
          model: "model-x",
          promptVersion: "protected-v1",
          interventionLevel: 2,
          latencyMs: 100,
          tokenUsage: { inputTokens: 5, outputTokens: 5 },
          freeText: `${key}@leak.example.com says hello`,
        },
      }),
    );
  }
  researcher = (await loadPrincipal(ids.research!))!;
  sysadmin = (await loadPrincipal(ids.sysadmin!))!;
  instructor = (await loadPrincipal(ids.instructor!))!;
  student = (await loadPrincipal(ids.student!))!;
});

afterAll(async () => {
  await disconnectPrisma();
});

const baseRequest = {
  courseId,
  fields: [
    "participantId",
    "condition",
    "eventName",
    "eventTime",
    "interventionLevel",
    "model",
    "promptVersion",
  ],
  format: "CSV" as const,
};

describe("research export authorization", () => {
  it("denies every non-research role (student, instructor, system admin)", async () => {
    for (const who of [student, instructor, sysadmin]) {
      await expect(createResearchExport(who, baseRequest)).rejects.toBeInstanceOf(AuthError);
    }
    expect(await prisma.researchExport.count({ where: { courseId } })).toBe(0);
  });

  it("denies download to non-research roles and audits an allowed download", async () => {
    const created = await createResearchExport(researcher, baseRequest);
    for (const who of [student, instructor, sysadmin]) {
      await expect(getResearchExportDownload(who, created.exportId)).rejects.toBeInstanceOf(
        AuthError,
      );
    }
    const file = await getResearchExportDownload(researcher, created.exportId);
    expect(file.contentType).toContain("text/csv");
    const audit = await prisma.auditLog.findFirst({
      where: { action: "research.export_download", targetId: created.exportId },
    });
    expect(audit?.actorId).toBe(researcher.id);
  });
});

describe("research export content", () => {
  it("rejects disallowed fields with a 400 and writes nothing", async () => {
    const before = await prisma.researchExport.count({ where: { courseId } });
    await expect(
      createResearchExport(researcher, {
        ...baseRequest,
        fields: ["participantId", "email", "name", "message"],
      }),
    ).rejects.toMatchObject({ status: 400, code: "field_not_allowed" });
    await expect(
      createResearchExport(researcher, { ...baseRequest, fields: ["userId"] }),
    ).rejects.toBeInstanceOf(HttpError);
    expect(await prisma.researchExport.count({ where: { courseId } })).toBe(before);
  });

  it("exports pseudonymous rows only: no names, emails or stray metadata; declined participants excluded", async () => {
    const res = await createResearchExport(researcher, baseRequest);
    expect(res.queued).toBe(false);
    expect(res.rowCount).toBe(2);

    const exp = await prisma.researchExport.findUniqueOrThrow({
      where: { id: res.exportId },
      include: { manifest: true },
    });
    expect(exp.status).toBe("COMPLETED");
    expect(exp.filePath?.startsWith("research-exports/")).toBe(true);
    const text = await readFile(path.join(storageDir, exp.filePath!), "utf8");

    // PII / content checks over the whole file.
    for (const needle of [
      "Alice",
      "Wonderland",
      "Bob",
      "Builder",
      "Carl",
      "itest.socra.local",
      "leak.example.com",
      "@",
      ids.student!,
      ids.consent!,
      ids.declined!,
    ]) {
      expect(text).not.toContain(needle);
    }
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe(
      "participantId,condition,eventName,eventTime,model,promptVersion,interventionLevel",
    );
    expect(lines).toHaveLength(3);
    expect(text).toContain(pseudonymFor(ids.student!));
    expect(text).toContain(pseudonymFor(ids.consent!));
    expect(text).not.toContain(pseudonymFor(ids.declined!));

    // Manifest + audit.
    expect(exp.manifest?.recordCount).toBe(2);
    expect(exp.manifest?.checksum).toBe(exp.checksum);
    expect(exp.manifest?.fieldsIncluded).toEqual(baseRequest.fields);
    expect(exp.manifest?.fieldsExcluded).toContain("raw message content");
    expect(exp.manifest?.version).toBeGreaterThanOrEqual(1);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "research.export", targetId: res.exportId },
    });
    expect(audit?.actorId).toBe(researcher.id);
    expect(audit?.metadata).toMatchObject({ rowCount: 2, checksum: exp.checksum });
  });

  it("JSON format contains only requested keys", async () => {
    const res = await createResearchExport(researcher, {
      ...baseRequest,
      fields: ["participantId", "condition"],
      format: "JSON",
    });
    const exp = await prisma.researchExport.findUniqueOrThrow({ where: { id: res.exportId } });
    const rows = JSON.parse(await readFile(path.join(storageDir, exp.filePath!), "utf8")) as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0]!)).toEqual(["participantId", "condition"]);
  });
});

describe("study condition changes", () => {
  it("are authorized, require a reason, and write a change row plus an audit entry", async () => {
    const participant = await prisma.studyParticipant.findUniqueOrThrow({
      where: { userId_courseId: { userId: ids.student!, courseId } },
    });
    await expect(
      changeParticipantCondition(student, participant.id, {
        toCondition: "CONTROL",
        reason: "I want to switch",
      }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      changeParticipantCondition(instructor, participant.id, {
        toCondition: "CONTROL",
        reason: "Instructor request",
      }),
    ).rejects.toBeInstanceOf(AuthError);
    await expect(
      changeParticipantCondition(researcher, participant.id, {
        toCondition: "SOCRATIC_AI",
        reason: "No actual change here",
      }),
    ).rejects.toMatchObject({ code: "same_condition" });

    const reason = "Misassigned at enrolment; protocol deviation PD-12";
    const result = await changeParticipantCondition(researcher, participant.id, {
      toCondition: "UNRESTRICTED_AI",
      reason,
    });
    expect(result).toMatchObject({ from: "SOCRATIC_AI", to: "UNRESTRICTED_AI" });

    const after = await prisma.studyParticipant.findUniqueOrThrow({
      where: { id: participant.id },
    });
    expect(after.condition).toBe("UNRESTRICTED_AI");
    const change = await prisma.studyConditionChange.findFirstOrThrow({
      where: { participantId: participant.id },
    });
    expect(change).toMatchObject({
      fromCondition: "SOCRATIC_AI",
      toCondition: "UNRESTRICTED_AI",
      reason,
      changedById: researcher.id,
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: "research.condition_change", targetId: participant.id },
    });
    expect(audit.actorId).toBe(researcher.id);
    expect(audit.reason).toBe(reason);
    expect(audit.metadata).toMatchObject({
      from: "SOCRATIC_AI",
      to: "UNRESTRICTED_AI",
      pseudonymousId: participant.pseudonymousId,
    });
    // Audit rows never carry the student's identity.
    expect(JSON.stringify(audit.metadata)).not.toContain("Alice");

    const evt = await prisma.analyticsEvent.findFirst({
      where: { eventName: "research_condition_changed", courseId, actorId: ids.student! },
    });
    expect(evt?.researchCondition).toBe("UNRESTRICTED_AI");
  });

  it("rejects a too-short reason", async () => {
    const participant = await prisma.studyParticipant.findUniqueOrThrow({
      where: { userId_courseId: { userId: ids.consent!, courseId } },
    });
    const { conditionChangeSchema } = await import("@/server/domain/research/participants");
    expect(
      conditionChangeSchema.safeParse({ toCondition: "SOCRATIC_AI", reason: "short" }).success,
    ).toBe(false);
    expect(participant.condition).toBe("CONTROL");
  });
});

describe("admin roster import and flags", () => {
  it("previews with duplicates and errors, applies once in a transaction, and audits", async () => {
    const course = await prisma.course.findUniqueOrThrow({ where: { id: courseId } });
    const csv = [
      "email,name,role,section,courseCode",
      `new1-${RUN}@itest.socra.local,New One,STUDENT,A,${course.code}`,
      `NEW1-${RUN}@itest.socra.local,New One Again,STUDENT,A,${course.code}`,
      `${mail("consent")},Bob Builder,STUDENT,B,${course.code}`,
      `${mail("student")},Alice Wonderland,STUDENT,,${course.code}`,
      `bad-email,Nope,STUDENT,A,${course.code}`,
    ].join("\n");
    const preview = await previewRosterImport(sysadmin, { courseId, fileName: "r.csv", csv });
    expect(preview.summary).toMatchObject({
      total: 5,
      create: 1,
      update: 1,
      duplicate: 2,
      invalid: 1,
    });

    const applied = await applyRosterImport(sysadmin, preview.importId);
    expect(applied).toMatchObject({ created: 1, updated: 1, skipped: 3 });
    await expect(applyRosterImport(sysadmin, preview.importId)).rejects.toMatchObject({
      code: "import_not_applicable",
    });

    const imp = await prisma.rosterImport.findUniqueOrThrow({
      where: { id: preview.importId },
      include: { rows: true },
    });
    expect(imp.status).toBe("APPLIED");
    expect(imp.rows.filter((r) => r.status === "APPLIED")).toHaveLength(2);
    const created = await prisma.user.findUnique({
      where: { email: `new1-${RUN}@itest.socra.local` },
    });
    expect(created).not.toBeNull();
    const m = await prisma.courseMembership.findUniqueOrThrow({
      where: { userId_courseId: { userId: ids.consent!, courseId } },
      include: { section: true },
    });
    expect(m.section?.code).toBe("B");
    expect(
      await prisma.auditLog.count({
        where: { action: "roster.import", targetId: preview.importId },
      }),
    ).toBe(1);

    // Students may not import rosters.
    await expect(
      previewRosterImport(student, { courseId, fileName: "r.csv", csv }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("flag updates are admin-only and audited", async () => {
    await expect(
      updateFlag(instructor, { key: "courseRag", courseId, enabled: false }),
    ).rejects.toBeInstanceOf(AuthError);
    await updateFlag(sysadmin, { key: "courseRag", courseId, enabled: false });
    const row = await prisma.featureFlag.findUniqueOrThrow({
      where: { key_scopeKey: { key: "courseRag", scopeKey: courseId } },
    });
    expect(row.enabled).toBe(false);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "flag.update", courseId, actorId: sysadmin.id },
    });
    expect(audit?.metadata).toMatchObject({ key: "courseRag", after: false });
  });
});

void os;
