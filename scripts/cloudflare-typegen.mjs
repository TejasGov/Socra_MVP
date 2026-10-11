import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Ignore local .env secrets when generating binding types. Widen string values because
// the same application and tests also run with Docker and Vercel configuration.
const result = spawnSync(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)),
    "types",
    "--env-interface",
    "CloudflareEnv",
    "cloudflare-env.d.ts",
    "--include-runtime",
    "false",
    "--strict-vars",
    "false",
  ],
  {
    stdio: "inherit",
    env: { ...process.env, CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false" },
  },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
