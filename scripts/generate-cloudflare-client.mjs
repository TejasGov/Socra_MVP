import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";

// Keep the Node.js client for local development and the separate background worker.
// Workers need a statically imported query compiler instead of runtime WASM compilation.
const source = await readFile("prisma/schema.prisma", "utf8");
const schema = source.replace(/generator client \{[\s\S]*?\}/, (block) => {
  const withoutRuntime = block.replace(/^\s*runtime\s*=.*$/m, "");
  return withoutRuntime.replace(/\}$/, '  runtime = "cloudflare"\n}');
});
if (schema === source) throw new Error("Could not configure the Prisma client for Cloudflare");

await mkdir(".data", { recursive: true });
const path = ".data/schema-cloudflare.prisma";
try {
  // .data and prisma are siblings, so the schema's relative output path stays valid.
  await writeFile(path, schema);
  const result = spawnSync(
    process.execPath,
    ["node_modules/prisma/build/index.js", "generate", "--schema", path],
    {
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(path, { force: true });
}
