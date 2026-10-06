import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { HttpError } from "@/server/http";
import { assertCan, type Principal } from "@/server/auth/rbac";
import {
  parseRosterCsv,
  planRows,
  summarizePlan,
  type ExistingMembership,
  type ExistingUser,
} from "./roster-csv";

export const rosterPreviewSchema = z.object({
  courseId: z.string().min(1),
  fileName: z.string().trim().min(1).max(200).default("roster.csv"),
  csv: z.string().min(1, "The file is empty"),
});

/** Parse + validate a CSV and persist a VALIDATED RosterImport with per-row results. Nothing is applied yet. */
export async function previewRosterImport(
  user: Principal,
  input: z.infer<typeof rosterPreviewSchema>,
) {
  assertCan(user, "course:roster:manage", { courseId: input.courseId });
  const course = await prisma.course.findUnique({
    where: { id: input.courseId },
    select: { id: true, code: true },
  });
  if (!course) throw new HttpError(404, "course_not_found", "Course not found");

  const parsed = parseRosterCsv(input.csv);
  if (parsed.fileErrors.length > 0) {
    throw new HttpError(400, "invalid_roster_file", parsed.fileErrors.join(" "), parsed.fileErrors);
  }

  const emails = [...new Set(parsed.rows.map((r) => r.email.trim().toLowerCase()).filter(Boolean))];
  const users = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true, name: true },
  });
  const usersByEmail = new Map<string, ExistingUser>(
    users.map((u) => [u.email.toLowerCase(), { id: u.id, name: u.name }]),
  );
  const memberships = await prisma.courseMembership.findMany({
    where: { courseId: course.id, userId: { in: users.map((u) => u.id) } },
    select: { userId: true, role: true, status: true, section: { select: { code: true } } },
  });
  const membershipsByUserId = new Map<string, ExistingMembership>(
    memberships.map((m) => [
      m.userId,
      { role: m.role, status: m.status, sectionCode: m.section?.code ?? null },
    ]),
  );

  const planned = planRows(parsed.rows, {
    courseCode: course.code,
    usersByEmail,
    membershipsByUserId,
  });
  const summary = summarizePlan(planned);

  const imp = await prisma.$transaction(
    async (tx) => {
      const created = await tx.rosterImport.create({
        data: {
          courseId: course.id,
          uploadedById: user.id,
          fileName: input.fileName,
          status: "VALIDATED",
          rowCount: summary.total,
          validCount: summary.valid,
          errorCount: summary.invalid,
          duplicateCount: summary.duplicate,
          report: { preview: summary },
        },
      });
      await tx.rosterImportRow.createMany({
        data: planned.map((r) => ({
          importId: created.id,
          rowNumber: r.rowNumber,
          email: r.email || null,
          name: r.name || null,
          role: r.role,
          sectionCode: r.sectionCode,
          status: r.status,
          action: r.action,
          errors: r.errors,
          userId: r.userId,
        })),
      });
      await writeAudit(
        {
          actorId: user.id,
          action: "roster.preview",
          targetType: "RosterImport",
          targetId: created.id,
          courseId: course.id,
          metadata: { fileName: input.fileName, ...summary },
        },
        tx,
      );
      return created;
    },
    { timeout: 60_000 },
  );
  return { importId: imp.id, courseId: course.id, summary, rows: planned };
}

export async function getRosterImport(user: Principal, importId: string) {
  const imp = await prisma.rosterImport.findUnique({
    where: { id: importId },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });
  if (!imp) throw new HttpError(404, "import_not_found", "Import not found");
  assertCan(user, "course:roster:manage", { courseId: imp.courseId });
  return imp;
}

export async function listRosterImports(user: Principal, courseId?: string) {
  assertCan(user, "course:manage");
  return prisma.rosterImport.findMany({
    where: courseId ? { courseId } : {},
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      courseId: true,
      fileName: true,
      status: true,
      rowCount: true,
      validCount: true,
      errorCount: true,
      duplicateCount: true,
      createdAt: true,
      appliedAt: true,
      course: { select: { code: true } },
    },
  });
}

/**
 * Apply a VALIDATED import in ONE transaction. Existing memberships are re-checked inside the transaction, so a stale
 * preview cannot create duplicates; the report records what actually happened.
 */
export async function applyRosterImport(user: Principal, importId: string) {
  const header = await prisma.rosterImport.findUnique({
    where: { id: importId },
    select: { courseId: true },
  });
  if (!header) throw new HttpError(404, "import_not_found", "Import not found");
  assertCan(user, "course:roster:manage", { courseId: header.courseId });

  return prisma.$transaction(
    async (tx) => {
      // Claim the import: only one apply can move it VALIDATED -> APPLIED.
      const claimed = await tx.rosterImport.updateMany({
        where: { id: importId, status: "VALIDATED" },
        data: { status: "APPLIED", appliedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new HttpError(
          409,
          "import_not_applicable",
          "This import was already applied or is not validated",
        );
      }
      const imp = await tx.rosterImport.findUniqueOrThrow({
        where: { id: importId },
        include: { rows: { orderBy: { rowNumber: "asc" } } },
      });

      const sectionIds = new Map<string, string>();
      const sectionFor = async (code: string | null) => {
        if (!code) return null;
        const cached = sectionIds.get(code);
        if (cached) return cached;
        const s = await tx.courseSection.upsert({
          where: { courseId_code: { courseId: imp.courseId, code } },
          create: { courseId: imp.courseId, code, name: code },
          update: {},
        });
        sectionIds.set(code, s.id);
        return s.id;
      };

      const counts = { created: 0, added: 0, updated: 0, skipped: 0 };
      const reportRows: Array<{ rowNumber: number; result: string; message?: string }> = [];

      for (const row of imp.rows) {
        if (row.status !== "VALID" || !row.email || !row.role || !row.name) {
          counts.skipped++;
          await tx.rosterImportRow.update({ where: { id: row.id }, data: { status: "SKIPPED" } });
          reportRows.push({
            rowNumber: row.rowNumber,
            result: "skipped",
            message: row.errors.join(" ") || row.status,
          });
          continue;
        }
        const sectionId = await sectionFor(row.sectionCode);
        let person = await tx.user.findUnique({ where: { email: row.email } });
        let result: "created" | "added" | "updated";
        if (!person) {
          person = await tx.user.create({
            data: { email: row.email, name: row.name, roles: ["STUDENT"] },
          });
          await tx.courseMembership.create({
            data: { userId: person.id, courseId: imp.courseId, role: row.role, sectionId },
          });
          result = "created";
        } else {
          const existing = await tx.courseMembership.findUnique({
            where: { userId_courseId: { userId: person.id, courseId: imp.courseId } },
          });
          if (
            existing &&
            existing.status === "ACTIVE" &&
            existing.role === row.role &&
            existing.sectionId === sectionId
          ) {
            counts.skipped++;
            await tx.rosterImportRow.update({
              where: { id: row.id },
              data: { status: "SKIPPED", userId: person.id },
            });
            reportRows.push({ rowNumber: row.rowNumber, result: "skipped", message: "No change." });
            continue;
          }
          await tx.courseMembership.upsert({
            where: { userId_courseId: { userId: person.id, courseId: imp.courseId } },
            create: { userId: person.id, courseId: imp.courseId, role: row.role, sectionId },
            update: { role: row.role, status: "ACTIVE", sectionId },
          });
          result = existing ? "updated" : "added";
        }
        if (result === "created") counts.created++;
        else if (result === "added") counts.added++;
        else counts.updated++;
        await tx.rosterImportRow.update({
          where: { id: row.id },
          data: { status: "APPLIED", userId: person.id },
        });
        reportRows.push({ rowNumber: row.rowNumber, result });
      }

      const report = { applied: counts, rows: reportRows } satisfies Prisma.InputJsonValue;
      await tx.rosterImport.update({ where: { id: importId }, data: { report } });
      await writeAudit(
        {
          actorId: user.id,
          action: "roster.import",
          targetType: "RosterImport",
          targetId: importId,
          courseId: imp.courseId,
          metadata: { fileName: imp.fileName, ...counts },
        },
        tx,
      );
      return { importId, courseId: imp.courseId, ...counts };
    },
    { timeout: 60_000 },
  );
}
