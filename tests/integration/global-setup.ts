import { execSync } from "node:child_process";
import pg from "pg";
import { testDatabaseUrl } from "../../vitest.config";

/**
 * Creates `<db>_test` on the docker Postgres (if missing) and applies all migrations with `prisma migrate deploy`.
 * Requires `docker compose up -d`.
 */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  const target = new URL(url);
  const dbName = target.pathname.replace(/^\//, "");
  const admin = new URL(url);
  admin.pathname = "/postgres";
  admin.searchParams.delete("schema");

  const client = new pg.Client({ connectionString: admin.toString() });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Integration tests need Postgres (docker compose up -d). Could not connect: ${(err as Error).message}`,
    );
  }
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (exists.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, "")}"`);
    }
  } finally {
    await client.end();
  }

  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
}
