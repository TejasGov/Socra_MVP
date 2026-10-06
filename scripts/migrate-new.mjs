#!/usr/bin/env node
// Create + apply a new Prisma migration while protecting raw-SQL objects Prisma cannot model
// (pgvector HNSW indexes). Usage: npm run db:migrate:dev -- --name add_something
//
// Prisma's differ does not know about `USING hnsw` indexes and will emit DROP INDEX statements for
// them in every new migration. This wrapper creates the migration with --create-only, strips those
// statements, then applies it with `prisma migrate dev`.
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const nameIdx = args.indexOf("--name");
const name = nameIdx >= 0 ? args[nameIdx + 1] : undefined;
if (!name) {
  console.error("Usage: npm run db:migrate:dev -- --name <migration_name>");
  process.exit(1);
}

const dir = "prisma/migrations";
const before = new Set(readdirSync(dir));
execSync(`npx prisma migrate dev --create-only --name ${name}`, { stdio: "inherit" });
const created = readdirSync(dir).filter(
  (d) => !before.has(d) && statSync(join(dir, d)).isDirectory(),
);
if (created.length === 0) {
  console.log("No new migration created (schema already in sync).");
  process.exit(0);
}
for (const d of created) {
  const file = join(dir, d, "migration.sql");
  const sql = readFileSync(file, "utf8");
  const cleaned = sql.replace(/-- DropIndex\r?\nDROP INDEX "[^"]*_hnsw_idx";\r?\n?/g, "");
  if (cleaned.trim() === "") {
    console.log(`Migration ${d} only contained protected-index drops; removing its SQL body.`);
    writeFileSync(file, "-- Intentionally empty (protected raw-SQL indexes only).\nSELECT 1;\n");
  } else if (cleaned !== sql) {
    writeFileSync(file, cleaned);
    console.log(`Stripped DROP INDEX statements for protected HNSW indexes from ${d}.`);
  }
}
// `migrate deploy` (not `migrate dev`): dev would re-diff and prompt to drop the protected indexes.
execSync("npx prisma migrate deploy", { stdio: "inherit" });
execSync("npx prisma generate", { stdio: "inherit" });
