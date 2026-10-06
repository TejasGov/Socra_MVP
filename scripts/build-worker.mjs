// Bundles worker/index.ts (and its src/server imports) into worker-dist/index.mjs for the production image.
// Node packages stay external (installed in the image); `server-only` resolves via the react-server condition.
import { build } from "esbuild";

await build({
  entryPoints: ["worker/index.ts"],
  outfile: "worker-dist/index.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  external: [],
  conditions: ["react-server"],
  // `server-only` is a build-time guard for React bundles; the worker is server-only by definition.
  alias: { "@": "./src", "server-only": "./tests/support/server-only-stub.ts" },
  sourcemap: true,
  logLevel: "info",
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
