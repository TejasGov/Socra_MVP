import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    // Temporary deployment bundles and local test caches are not source code.
    ".data/**",
    "out/**",
    "build/**",
    "worker-dist/**",
    "src/generated/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    // Plain CommonJS that runs inside the sandbox containers, not app code.
    "docker/runner/**",
    // Design-audit screenshot scripts and captures (local tooling output).
    ".playwright-mcp/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    },
  },
  {
    // Client components and UI must not reach into server-only modules or Prisma.
    files: ["src/components/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/*", "@/generated/*"],
              message: "UI/lib code must not import server modules or Prisma.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["worker/**/*.ts", "prisma/**/*.ts", "scripts/**/*.mjs", "tests/**/*.ts"],
    rules: { "no-console": "off" },
  },
  {
    // Playwright fixtures name their callback `use`; that is not a React hook.
    files: ["tests/e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
]);
