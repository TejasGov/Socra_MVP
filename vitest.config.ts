import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "vitest/config";

// Same precedence as Next.js: .env.local overrides .env (real env vars win).
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const devDatabaseUrl =
  process.env.DATABASE_URL ?? "postgresql://socra:socra@localhost:5544/socra?schema=public";

/** Integration tests use a separate database on the same server: `<db>_test` (created + migrated by global setup). */
export function testDatabaseUrl(url: string = devDatabaseUrl): string {
  const u = new URL(url);
  const db = u.pathname.replace(/^\//, "") || "socra";
  u.pathname = `/${db.endsWith("_test") ? db : `${db}_test`}`;
  return u.toString();
}

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // `server-only` throws outside the react-server condition; tests run server modules directly.
  "server-only": fileURLToPath(new URL("./tests/support/server-only-stub.ts", import.meta.url)),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
          env: { NODE_ENV: "test" },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          env: { NODE_ENV: "test", DATABASE_URL: testDatabaseUrl() },
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
