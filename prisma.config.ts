import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Mirror Next.js precedence: .env.local overrides .env. Existing process env always wins.
loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const fallbackUrl = "postgresql://socra:socra@localhost:5544/socra?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx --conditions=react-server prisma/seed/index.ts",
  },
  datasource: {
    // A fallback keeps `prisma generate` working on machines without env files (CI, Docker build).
    url: process.env.DATABASE_URL ?? fallbackUrl,
  },
});
