/**
 * Runs every seeded Python/JavaScript reference solution through the real code runner (docker) using the
 * TestCase rows stored in the database. Usage: npx tsx --conditions=react-server prisma/seed/verify-runner.ts
 */
import "../../worker/load-env";
import { getPrisma, disconnectPrisma } from "@/server/db";
import { testCaseToSpec } from "@/server/domain/assignments/test-mapping";
import { defaultRunLimits, getCodeRunner } from "@/server/runner";
import type { RunnerLanguage } from "@/server/runner/types";

async function main() {
  const prisma = getPrisma();
  const qvs = await prisma.questionVersion.findMany({
    where: {
      type: "CODING",
      language: { in: ["PYTHON", "JAVASCRIPT"] },
      referenceSolution: { not: null },
    },
    include: { testCases: true },
  });
  let bad = 0;
  for (const qv of qvs) {
    const language = qv.language as RunnerLanguage;
    const tests = qv.testCases.map((t) => testCaseToSpec(t as never, qv.entryPoint));
    const res = await getCodeRunner().run({
      runId: `verify_${qv.id}`.slice(0, 60),
      language,
      files: [
        {
          path: language === "PYTHON" ? "main.py" : "main.js",
          content: qv.referenceSolution as string,
        },
      ],
      entryFile: language === "PYTHON" ? "main.py" : "main.js",
      tests,
      mode: "tests",
      limits: defaultRunLimits(language),
    });
    const failed = res.testResults.filter((t) => !t.passed).map((t) => t.name);
    console.log(
      `${res.status === "OK" && failed.length === 0 ? "OK  " : "FAIL"} ${qv.title}: ${res.testResults.length - failed.length}/${res.testResults.length} ${res.stderr.slice(0, 200)}`,
    );
    if (res.status !== "OK" || failed.length) bad++;
  }
  await disconnectPrisma();
  process.exit(bad ? 1 : 0);
}
void main();
