# Socra Pilot Research V1

A pilot learning environment for CSE 115 and CSE 116. It combines protected Socratic AI help inside assignments, a
coding workspace with sandboxed execution (Python, JavaScript, Scala), adaptive practice, a learner profile, faculty
analytics and pseudonymous research exports. Everything runs on your machine with no paid credentials: without an
OpenAI key the app uses a deterministic mock AI.

- Architecture, data planes and diagrams: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Security and the pre-launch checklist: [docs/SECURITY.md](docs/SECURITY.md)
- What is not done or not verified: [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)

## Prerequisites

- **Node.js 22.12 or newer** (Node 24 works) and npm 10+
- **Docker Desktop** (or Docker Engine) running. It hosts Postgres with pgvector and Redis, and it runs every student
  code execution in a throwaway container.
- **About 8 GB of free disk** for the code-runner images. The Scala image alone is about 4.9 GB.
- Free local ports: 3000 (web), 3001 (worker health), 5544 (Postgres), 6390 (Redis).

## Setup

Run these from the repository root, in order.

```bash
cp .env.example .env.local        # PowerShell: Copy-Item .env.example .env.local
docker compose up -d              # Postgres on localhost:5544, Redis on localhost:6390
npm install                       # also runs `prisma generate`
npm run db:migrate                # applies the 2 migrations (pgvector extension, indexes, append-only triggers)
npm run db:seed                   # demo users, 2 courses, assignments, activity (safe to re-run)
npm run runner:pull               # once: pulls base images and BUILDS the sandbox images
npm run dev                       # web on :3000 plus the worker (health: http://localhost:3001/health)
```

Then open **http://localhost:3000**. You land on the sign-in page.

About `npm run runner:pull`: code execution needs three local images, `socra-runner-python:1`,
`socra-runner-node:1` and `socra-runner-scala:1`. The script pulls `python:3.12-alpine`, `node:22-alpine` and
`virtuslab/scala-cli`, then builds the three tagged images from `docker/runner/*.Dockerfile`. It takes a while the first
time (the Scala image is large and bakes in the compiler cache because sandboxes have no network). Use
`npm run runner:pull -- --skip-scala` to skip Scala; Scala questions then report the runner as unavailable. Everything
else works without the images; only the Run buttons and grading of hidden tests need them.

`.env.local` is read by Next.js, the worker, the seed and Prisma. The defaults work for local development.

## Demo logins

Every seeded account uses the password **`socra-dev-password`**. These accounts exist only in development data; never
seed a production database.

| Email                                              | Role                                                    | Lands on     |
| -------------------------------------------------- | ------------------------------------------------------- | ------------ |
| `student1@socra.local` ... `student30@socra.local` | Student                                                 | `/home`      |
| `faculty@socra.local`                              | Instructor in CSE 115 and CSE 116 (Dana Whitfield)      | `/faculty`   |
| `faculty2@socra.local`                             | Instructor in CSE 116 (Marcus Oyelaran)                 | `/faculty`   |
| `ta@socra.local`                                   | Teaching assistant in both courses (Priya Raman)        | `/faculty`   |
| `research@socra.local`                             | Research admin (Elena Sorensen)                         | `/research`  |
| `admin@socra.local`                                | System admin (Sam Kowalski)                             | `/admin`     |

Enrollment: CSE 115 has students 1-20 (sections A1: 1-10, A2: 11-20). CSE 116 has students 1-3 and 11-30 (section B1).
So `student1` to `student3` are in both courses. Research conditions: `student1` to `student3` are in the Socratic
condition; the others rotate among Socratic, unrestricted AI and control (control students get no Socra); every 10th
student has declined research consent and is excluded from exports.

## Guided demo (about 15 minutes, mock AI)

Use a private window per role, or sign out between steps.

**1. Student path** (`student1@socra.local`)

1. Open **CSE 115** and the open assignment **HW4: Lists and loops**. Note the mode banner (protected assessment).
2. Edit the Python code, press **Run**, then **Run public tests**. Output appears in the console; hidden tests are never
   shown.
3. Ask **Socra** a question such as "Why does my loop stop early?". The reply streams in, shows a guidance level (L0 to
   L6) and may cite course material. Ask for the answer outright and note that it declines and asks a guiding question.
4. Press **Submit** and confirm. A confirmation shows the attempt; the grade is held until faculty return it.
5. Open **Practice**, start a session on a topic marked as needing reinforcement, answer a few items, and read the
   feedback and the difficulty change.
6. Open **Profile** to see topic states (needs reinforcement, developing, consistently demonstrated) built from your
   evidence. It never shows a percentage.
7. Open **HW3: Recursion** (closed, solutions released) to see **review mode** with the reference solution and a
   review-mode Socra. Submitting an open assignment never unlocks solutions.

**2. Faculty path** (`faculty@socra.local`)

1. **/faculty** shows the course overview built from aggregates. Metrics with fewer than 5 students read "Insufficient
   data".
2. **Analytics** and **Insights**: open a question and a topic drilldown. There are no raw student chats anywhere here.
3. **Assignments > New**: describe an assignment and use the copilot to draft questions, tests and rubric, then run the
   policy test to see how Socra would respond. Publish or leave as draft.
4. Open an assignment's **Preview** (reads and writes no student data), then its **Submissions** and a **Grading** page
   to review tests, rubric and an AI suggestion (suggestions never change a grade by themselves), then finalize.
5. **Materials**: upload a `.md` or `.txt` file (up to 1 MB). Socra can then cite it.
6. **CSE 116** (also `faculty2`): the Scala assignments **HW2** and **HW3**. The first Scala run is slow (several seconds).

**3. Review mode, with an instructor's controls** (`faculty@socra.local`)

Close an open assignment, then use the release control to release solutions. Students then see review mode. Reopening
withdraws the release. Each of these is audited.

**4. Research export** (`research@socra.local`)

1. **/research** shows participants and conditions; change a condition and note it is audited.
2. **Exports**: pick fields from the allowlist (names, emails, raw messages and code cannot be selected), a format (CSV
   or JSON) and a filter, then create the export. Download it and open the manifest: participants are pseudonyms like
   `p_1a2b3c...`, and declined-consent students are absent.

**5. Admin** (`admin@socra.local`)

1. **Feature flags**, **AI** (model config, budgets, kill switch) and **Usage**.
2. **Jobs** (outbox, failed jobs, queue state) and **Health**.
3. **Audit**: see the entries your demo created (login, publish, close, release, export).
4. **Roster**: import a CSV, change roles, and issue a time-limited **transcript access grant**. Raw transcripts need a
   grant plus a written reason, and every read is logged; faculty and TAs can never read them.

## AI: mock mode and real OpenAI

With no `OPENAI_API_KEY`, the app runs in **AI mock mode**: replies are deterministic templates, no network calls are
made, and a small `AI MOCK MODE` label appears in the app. The levels, citations, policy check, budgets and logging all
still run, so the product can be demonstrated end to end.

To use the OpenAI Responses API, set these in `.env.local` and restart:

```bash
OPENAI_API_KEY=sk-...
OPENAI_PROTECTED_MODEL=<model for Socra, grading suggestions, authoring>
OPENAI_ECONOMY_MODEL=<model for practice, misconception extraction, analytics briefs>
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

The key is read only on the server and is never sent to the browser. Requests are sent with `store: false`. The
defaults for the model variables are placeholders; check them against your account. `AI_MOCK_MODE=true` forces mock mode
even when a key is present. Other AI controls (`OPENAI_BASE_URL`, `OPENAI_ORG_ID`, timeouts, token caps, turn limits,
`AI_COURSE_BUDGET_USD`, `AI_KILL_SWITCH`) are documented in `.env.example`. With a key, the `embeddings` job indexes
uploaded materials and retrieval becomes hybrid (vector plus full-text). Materials that existed before the key was added
(including the seeded lectures) are embedded once with:

```bash
npm run ai:embed
```

To run every AI feature on the cheaper model, point both tiers at it (e.g. `OPENAI_PROTECTED_MODEL=gpt-6-luna`); cost is
always computed from the model that actually served the request.

## University SSO (OpenID Connect)

Set all four and restart. Until then `/api/auth/oidc/start` returns 503 and local accounts keep working.

```bash
OIDC_ISSUER=https://idp.example.edu
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_REDIRECT_URI=http://localhost:3000/api/auth/oidc/callback   # must match the IdP registration exactly
```

Optional: `OIDC_SCOPES` (default `openid email profile`), `OIDC_EMAIL_CLAIM` (default `email`) and
`OIDC_AUTO_PROVISION` (default `false`: only pre-provisioned users, matched by email, may sign in). The flow is
authorization code with PKCE. Set `AUTH_LOCAL_ENABLED=false` when SSO is live. The adapter has not been tested against a
real identity provider; read [docs/SECURITY.md](docs/SECURITY.md) first.

## Build, start and the worker

```bash
npm run build           # prisma generate, next build, then bundles the worker to worker-dist/index.mjs
npm run start           # serves the production build on :3000
npm run worker          # worker only (outbox dispatcher, queues, health on :3001)
npm run dev:web         # web only, without the worker
```

In production mode (`NODE_ENV=production`) the app refuses to start without `SESSION_SECRET` (32+ characters),
`RESEARCH_PSEUDONYM_SECRET`, `DATABASE_URL` and `REDIS_URL`. The worker is required for code execution, the outbox
(learning evidence, analytics), aggregation, embeddings and exports. To run the production image under Compose:
`docker compose --profile app up -d --build` (note that code execution does not work from the containerized worker; see
[docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)).

Health: `GET /api/health` (database, Redis, runner driver, AI mode) and `GET http://localhost:3001/health` (database,
Redis, queue depths, outbox).

## Tests and checks

```bash
npm run lint            # ESLint
npm run typecheck       # prisma generate + tsc --noEmit
npm run format:check    # Prettier (npm run format to fix)
npm test                # all Vitest projects: unit + integration
npm run test:unit       # unit only, no services needed
npm run test:integration  # needs `docker compose up -d`; uses a separate <db>_test database
npm run test:e2e        # Playwright; needs the app's database seeded
```

Integration tests create and migrate their own `<db>_test` database on the compose Postgres. The runner integration
tests use the sandbox images and skip a language when its image is missing. For Playwright, install the browser once:

```bash
npx playwright install chromium
```

`test:e2e` starts `npm run dev` itself (or reuses a running server). Set `E2E_USE_BUILD=1` to test `npm run start`
instead, and `PLAYWRIGHT_BASE_URL` to point elsewhere. CI (`.github/workflows`) runs migrate, seed, lint, typecheck,
unit, integration and build.

## Database

| Command                                      | What it does                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run db:migrate`                         | Apply migrations (`prisma migrate deploy`)                                           |
| `npm run db:migrate:dev -- --name <name>`    | Create and apply a new migration; strips the spurious `DROP INDEX` lines for HNSW indexes Prisma cannot model |
| `npm run db:seed`                            | Seed demo data; idempotent and deterministic                                          |
| `npm run db:reset`                           | **Drops and recreates the database** (`prisma migrate reset --force`)                 |
| `npm run db:studio`                          | Prisma Studio                                                                        |
| `npm run db:generate`                        | Regenerate the Prisma client into `src/generated/prisma`                              |

**Run `npm run db:reset` yourself, in your own terminal.** Prisma refuses `migrate reset --force` when it detects an AI
coding tool, unless you give explicit consent, so an AI agent cannot run it for you. After a reset, run
`npm run db:seed` if the seed did not run. To start completely fresh including Redis:
`docker compose down -v && docker compose up -d && npm run db:migrate && npm run db:seed`.

## Troubleshooting

- **A port is already in use.** Postgres uses host port 5544 and Redis 6390 to stay clear of local installs. The web app
  uses 3000 and the worker health server 3001. To move Postgres or Redis, change both `docker-compose.yml` and
  `DATABASE_URL` / `REDIS_URL` in `.env.local`. To move the web port, run `npx next dev --port <n>` and set `APP_URL` to
  match. Change the worker port with `WORKER_HEALTH_PORT`.
- **`Can't reach database server`.** Run `docker compose ps` and wait until both services are `healthy`.
- **Run buttons say the runner is unavailable.** Check that Docker is running, that the worker is running (`npm run dev`
  starts it; look for `[worker]` lines or open http://localhost:3001/health), that Redis is up, and that you ran
  `npm run runner:pull`. `docker image ls | grep socra-runner` should list the images. The rest of the app works without
  the runner.
- **Prisma client missing or out of date** (errors importing `@/generated/prisma/...`, or "Cannot find module"). Run
  `npm run db:generate`. It also runs on `npm install` and `npm run build`.
- **Playwright cannot launch a browser.** Run `npx playwright install chromium`.
- **Worker did not start queue workers.** If Redis was down at startup the worker logs it and only runs the outbox.
  Restart it once Redis is up.
- **Scala runs time out or the first one is slow.** The first run per container takes several seconds; the limit is
  `RUNNER_SCALA_TIMEOUT_MS` (45 s). Give Docker Desktop at least 4 GB of memory.
- **Windows.**
  - Use Docker Desktop with the WSL 2 backend and Linux containers, and keep it running.
  - In PowerShell, copy the env file with `Copy-Item .env.example .env.local`. In Git Bash `cp` works.
  - The Docker integration sets `MSYS_NO_PATHCONV` for you; if you invoke `docker` by hand from Git Bash and see path
    mangling, set `MSYS_NO_PATHCONV=1` yourself.
  - If `docker` is not on `PATH` for the worker, set `DOCKER_BIN` to its full path.
  - If a port is reserved by Windows (`netsh interface ipv4 show excludedportrange protocol=tcp`), pick another.
  - Windows Defender can slow `npm install` and the Next dev compiler; excluding the project folder helps.

## Project layout

```text
src/app/            Next.js pages and route handlers: (public) (student) (faculty) (admin) api/
src/components/     UI primitives, shell, workspace editor, Socra panel, practice
src/server/         All business logic: auth, ai, events, runner, flags, audit, domain/*
worker/             Background worker: outbox dispatcher, BullMQ processors, health server
prisma/             schema.prisma, migrations, deterministic seed (prisma/seed)
docker/runner/      Sandbox images and harnesses (Python, Node, Scala)
scripts/            runner-pull, build-worker, migrate-new
tests/              unit, integration, e2e
docs/               Documentation (index below)
```

## Documentation index

| Document                                                                | What it covers                                                          |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                            | Components, four data planes, module map, diagrams, state machine, sandbox, vectors |
| [docs/SECURITY.md](docs/SECURITY.md)                                    | Auth, RBAC, transcripts, sandbox threat model, secrets, audit, pre-launch checklist |
| [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md)                  | What is stubbed, untested or heuristic                                  |
| [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md)                              | Decisions and assumptions, appended per agent                           |
| [docs/BUILD_STATUS.md](docs/BUILD_STATUS.md)                            | Build log: what was done and verified                                   |
| [docs/LEARNER_MODEL.md](docs/LEARNER_MODEL.md)                          | The `ltm-v1` learner model                                              |
| [docs/ANALYTICS_DICTIONARY.md](docs/ANALYTICS_DICTIONARY.md)            | Every faculty metric and its definition                                 |
| [docs/RESEARCH_DATA_DICTIONARY.md](docs/RESEARCH_DATA_DICTIONARY.md)    | Research export fields, pseudonymization, manifest                       |
| [docs/DESIGN_GUARDRAILS.md](docs/DESIGN_GUARDRAILS.md), [docs/UI_PRIMITIVES.md](docs/UI_PRIMITIVES.md) | Design rules and UI component reference |
| [docs/socra_pilot_research_v1_prd.md](docs/socra_pilot_research_v1_prd.md) | Product requirements                                                 |
| `docs/_TASK_SPEC.md`, `docs/_BUILD_PLAN.md`, `docs/_CONTRACTS.md`, `docs/_source_digest.md` | Internal build specification and contracts |
