import { PrismaPg } from "@prisma/adapter-pg";
import { config as loadEnv } from "dotenv";
import { PrismaClient } from "../../../src/generated/prisma/client";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

/**
 * Playwright global teardown: archive every assignment the suite created (title starts with "E2E")
 * so test fixtures never show up in student, faculty or analytics views of the dev database.
 * ARCHIVED assignments are excluded from those lists by default.
 */
export default async function globalTeardown(): Promise<number> {
  const raw = process.env.DATABASE_URL;
  if (!raw) return 0;
  const url = new URL(raw);
  const schema = url.searchParams.get("schema") ?? undefined;
  url.searchParams.delete("schema");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString(), max: 2 }, { schema }),
  });
  try {
    const res = await prisma.assignment.updateMany({
      where: { title: { startsWith: "E2E" }, state: { not: "ARCHIVED" } },
      data: { state: "ARCHIVED", archivedAt: new Date() },
    });
    if (res.count > 0) console.log(`E2E teardown: archived ${res.count} E2E assignment(s).`);
    return res.count;
  } finally {
    await prisma.$disconnect();
  }
}
