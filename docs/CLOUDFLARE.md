# Cloudflare deployment

Socra deploys to Cloudflare **Workers** with OpenNext. This preserves the existing Next.js build and Docker/Vercel workflows. The adapter uses the Node compatibility layer; it does not turn this app into a static site.

The deployed app is at [learn.socra.workers.dev](https://learn.socra.workers.dev). The Worker is named `learn` and the account's free Workers subdomain is `socra`. It uses the existing hosted Neon database and the private `socra-pilot-exports` R2 bucket.

## Account and runtime requirements

- The deployment currently stays on **Workers Free**, as requested. Live sign-in and repeated authenticated page requests passed, and a private R2 upload/download checksum check passed. The Free plan's 10 ms CPU limit terminated the empty research export smoke test and can also affect other dynamic requests; the deployed app is a limited preview on this plan. **Workers Paid** provides more CPU time and starts at $5/month plus usage above included allowances. Activating R2 alone does not upgrade Workers. See [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) and [CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).
- Authenticate with `npx wrangler login`.
- Enable R2 in the Cloudflare dashboard, then create the private export bucket with `npx wrangler r2 bucket create socra-pilot-exports`. Leave public access disabled.
- Supply a hosted PostgreSQL database with the existing migrations and pgvector extension. The app uses the existing Prisma 7 driver. Cloudflare gets a client per request and closes each released connection instead of sharing TCP sockets between requests.
- `INLINE_JOBS=true` processes the outbox, analytics and embeddings after mutations. Without Redis, rate limits and job throttles use the existing per-instance fallback. For a production rollout, distributed rate limits and reliable scheduled jobs still need a separate backend.
- Code execution requires a trusted sandbox service implementing `src/server/runner/remote-runner.ts`. Set `REMOTE_RUNNER_URL` and `REMOTE_RUNNER_TOKEN` as secrets. Until configured, Run and automated grading report runner unavailable. Workers cannot execute Docker containers.
- R2 stores research exports. Large queued exports and scheduled retention still require the separate background worker; inline jobs do not process every BullMQ queue.

## Configure secrets

Keep these in Cloudflare secrets, never in `wrangler.jsonc` or Git:

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put SESSION_SECRET
npx wrangler secret put RESEARCH_PSEUDONYM_SECRET
npx wrangler secret put APP_URL
# Optional integrations:
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put REMOTE_RUNNER_URL
npx wrangler secret put REMOTE_RUNNER_TOKEN
```

Use at least 32 random characters for `SESSION_SECRET` and an independent random research pseudonym secret. `APP_URL` must match the final HTTPS origin, including for CSRF checks. Configure all four OIDC variables if using university SSO. Empty `OPENAI_API_KEY` selects mock AI.

The initial Cloudflare credentials are backed up in the ignored `.env.cloudflare.production` file. Keep that file private. The session and research secrets were generated for this deployment; sessions and research pseudonyms differ from deployments that use another secret. Vercel exports can contain `[SENSITIVE]` placeholders; never upload those as real secret values.

Use a pooled PostgreSQL URL for the application. Apply migrations with a direct database URL using `npm run db:migrate` only when the chosen database needs them. Never run the development seed against production.

For an existing Worker, secret commands publish new versions immediately. Use `wrangler versions secret` when changes must be staged.

## Build, preview and deploy

```bash
npm ci
npm run build:cloudflare
npx wrangler deploy --dry-run
npm run deploy:cloudflare:built
```

OpenNext packaging requires Linux/macOS or WSL with Linux Node.js and Linux-installed dependencies. Windows builds can fail at symlink creation even when `next build` succeeds. Use a separate Linux checkout rather than sharing Windows `node_modules` with WSL.

The Cloudflare build generates Prisma with `runtime = "cloudflare"` using a temporary copy of the schema. This bundles the query compiler as a static WASM module, as Workers prohibit runtime WASM compilation. Run `npm run db:generate` before returning to Node.js development in the same checkout; normal builds, type checks and dependency installs already do this.

For local Workers preview, copy `.dev.vars.example` to the ignored `.dev.vars` and fill in the desired database and secrets, then run `npm run preview:cloudflare`. This uses local R2 simulation, but database calls still reach the database configured in `.dev.vars`.

Regenerate binding types after config changes with `npm run cf:typegen`. This excludes local environment files so the shared Node.js application and tests do not inherit unrelated secret declarations.

For Cloudflare Workers Builds connected to this Git repository:

| Setting        | Value                                    |
| -------------- | ---------------------------------------- |
| Root directory | repository root                          |
| Build command  | `npm run build:cloudflare`               |
| Deploy command | `npm run deploy:cloudflare:built`        |
| Node version   | 24.11.0 or a compatible Node 22+ version |
| Worker name    | `learn`                                  |

Keep runtime secrets in the Worker settings. The build does not require production secrets. Configure the account, R2 bucket and runtime secrets before publishing. Check the deployment's reported compressed bundle size against the account's Workers plan before proceeding.

Verify `/login`, `/api/health`, signed-out redirects, a real sign-in, and several consecutive authenticated database requests. Verify a small research export and download with an authorized research account. Verify code execution only after connecting the sandbox service.

## Agent setup

Cloudflare skills are installed globally under `C:/Users/Tejas/.agents/skills`. The `cloudflare` MCP server is registered in `C:/Users/Tejas/.codex/config.toml` and authenticated; restart Codex to load it. The project uses Wrangler, so the optional beta `cf` CLI is unnecessary for this deployment.

References: [Cloudflare agent setup](https://developers.cloudflare.com/agent-setup/prompt.md), [OpenNext configuration](https://opennext.js.org/cloudflare/get-started), [Workers database connections](https://opennext.js.org/cloudflare/howtos/db), [Cloudflare Next.js deployment paths](https://developers.cloudflare.com/workers/framework-guides/web-apps/opennext/).
