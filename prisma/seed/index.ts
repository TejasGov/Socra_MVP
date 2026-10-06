/**
 * Deterministic, idempotent development seed. Run: `npm run db:seed` (safe to re-run).
 *
 * Order matters: users -> courses (+ memberships) -> topics -> research participants -> ops defaults.
 * Extend by adding modules (assignments, resources, evidence, events, ...) after `seedTopics` and
 * registering them in SEED_STEPS below. Every module must be idempotent.
 */
import "../../worker/load-env";
import bcrypt from "bcryptjs";
import { disconnectPrisma, getPrisma } from "@/server/db";
import { DEMO_PASSWORD, type SeedContext } from "./context";
import { seedActivity } from "./activity";
import { seedAssignments } from "./assignments";
import { seedCourses } from "./courses";
import { seedMisconceptions } from "./misconceptions";
import { seedOpsData } from "./ops-data";
import { seedPractice } from "./practice";
import { seedReset } from "./reset";
import { seedResources } from "./resources";
import { S } from "./state";
import { seedBudgets, seedModelConfig, seedRetention } from "./ops";
import { seedResearch } from "./research";
import { seedTopics } from "./topics";
import { seedUsers } from "./users";

type SeedStep = { name: string; run: (ctx: SeedContext) => Promise<void> };

export const SEED_STEPS: SeedStep[] = [
  { name: "users", run: seedUsers },
  { name: "courses", run: seedCourses },
  { name: "topics", run: seedTopics },
  { name: "research", run: seedResearch },
  { name: "model-config", run: seedModelConfig },
  { name: "budgets", run: seedBudgets },
  { name: "retention", run: seedRetention },
  // Generated demo data (agent I). Idempotent: see reset.ts.
  { name: "reset-generated", run: seedReset },
  { name: "assignments", run: seedAssignments },
  { name: "resources", run: seedResources },
  { name: "misconceptions", run: seedMisconceptions },
  { name: "practice", run: seedPractice },
  { name: "activity", run: seedActivity },
  { name: "ops-data", run: seedOpsData },
];

async function main() {
  const started = Date.now();
  const prisma = getPrisma();
  const ctx: SeedContext = {
    prisma,
    // Cost 10 keeps the seed fast; login verifies any bcrypt cost.
    passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
    now: new Date(),
    ids: { users: {}, courses: {}, topics: {} },
    log: (msg) => console.info(`[seed] ${msg}`),
  };
  for (const step of SEED_STEPS) {
    await step.run(ctx);
  }
  console.info(`[seed] counts: ${JSON.stringify(S.counts)}`);
  console.info(
    `[seed] done in ${((Date.now() - started) / 1000).toFixed(1)}s. Password for all accounts: ${DEMO_PASSWORD}`,
  );
}

main()
  .catch((err) => {
    console.error("[seed] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
