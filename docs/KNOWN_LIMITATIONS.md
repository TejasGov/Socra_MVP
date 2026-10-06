# Known limitations

Factual list of what is not done, not verified, or weaker than it may look. Sources: `docs/BUILD_STATUS.md`,
`docs/ASSUMPTIONS.md`, notes in the code, and checks made while writing the documentation. Each item says what is
actually true. See [SECURITY.md](SECURITY.md) for the pre-launch checklist.

## AI and Socra

- **The policy check is heuristic.** `src/server/ai/policy-check.ts` (checker `rules-v1`) compares the reply with hidden
  test values, reference-solution token 3-grams and the target function definition, and redacts long code blocks. It is
  rule-based and not jailbreak-proof: a paraphrased hint, an unusual encoding of a value, or a solution spread across
  several turns can pass. The prompt also tells the model not to leak, which is not a guarantee either. Unit tests
  cover the rules, not an adversarial red team.
- **Mock mode is not a model.** With no `OPENAI_API_KEY` (or `AI_MOCK_MODE=true`) replies come from deterministic
  templates. They demonstrate the flow, levels, citations and policy outcomes, but say nothing about tutoring quality.
- **The real OpenAI path is not exercised by automated tests.** The provider (`src/server/ai/providers/openai.ts`)
  compiles and follows the Responses API shape, but tests run against the mock. Default model names
  (`OPENAI_PROTECTED_MODEL=gpt-6.1-sol`, `OPENAI_ECONOMY_MODEL=gpt-6-luna`) and the planning prices in `.env.example` must be
  checked against your account before use. Cost figures are estimates, not quotes.
- **Protected replies are buffered, not token-streamed.** The full reply is validated and policy-checked, then sent in
  small chunks. Latency to first text equals the model's full response time.
- **Misconception extraction depends on the model.** Labels come from the model's structured output; unknown labels are
  stored as `AI_PROPOSED` candidates with `PENDING` review status.
- **There is no UI to review misconception candidates.** `reviewMisconceptionCandidate` and
  `listMisconceptionCandidates` exist in `src/server/domain/misconceptions/index.ts` but no route or page calls them.
  Until one exists, candidates stay `PENDING`, and analytics count approved labels only, so new labels do not reach the
  faculty misconception views. Approval currently needs a database or script change.
- **AI grading suggestions never count.** They are shown to faculty on request (not automatically at submission) and
  never produce learning evidence or metrics.

## Code execution

- **Scala is slow.** About 4.4 s for a plain run per cold container, about 8 s for a stdio test run, and about 13 s for
  function tests on Docker Desktop for Windows (compile plus JVM start). Python is about 0.8 s and JavaScript about 0.55 s.
  Scala gets a 45 s timeout (`RUNNER_SCALA_TIMEOUT_MS`), at least 768m of memory and 1 CPU.
- **The Scala image is about 4.9 GB** (`socra-runner-scala:1`, built from `virtuslab/scala-cli`), with the Scala 3
  compiler cache baked in because sandboxes have no network. `npm run runner:pull -- --skip-scala` skips it; Scala
  questions then report the runner as unavailable.
- **Scala function tests run in one JVM** with an overall timeout only, not a per-test timeout.
- **Containers share the host kernel.** Isolation is standard Docker hardening (see SECURITY.md section 4), not a
  microVM. Do not treat it as sufficient for hostile multi-tenant use.
- **The remote runner is untested.** `src/server/runner/remote-runner.ts` is a thin client for an HTTP contract; it has
  not been run against a real service.
- **The containerized worker cannot run code.** The `Dockerfile` does not include the Docker CLI or socket access, so
  with `docker compose --profile app up` the `worker` service starts but code runs report the runner as unavailable.
  Run the worker on the host (`npm run dev` or `npm run worker`) for execution.
- **Run results need the worker.** If Redis or the worker is down the API answers `RUNNER_UNAVAILABLE` after a probe of
  about 3 seconds, or after `RUNNER_WAIT_TIMEOUT_MS` (60 s) if a run is queued but not picked up.
- **Run job payloads pass through Redis** (code and, for grading, hidden-test expectations). They are deleted as soon
  as the web process has the result, and expire 60 seconds after completion or failure otherwise.
- **Docker must be reachable on the host.** If Docker Desktop is stopped, runs fail with an unavailable result; the
  rest of the app keeps working.

## Grading and assignments

- **Grading runs in the web process.** After a submission the app grades with `after()` (`src/app/api/submissions/route.ts`).
  The `grading` BullMQ queue exists but has no processor. If grading fails (for example the runner is down) the grade
  stays pending and is retried through `POST /api/grading/submissions/:id/retry` or `retryPendingGrades()`; there is no
  automatic sweeper.
- **Scheduled open and close are lazy.** Transitions are applied when an assignment is read or submitted, not by a timer,
  so a scheduled assignment's state in a raw database read can be stale until someone opens it.
- **Published content is frozen.** After publishing, only dates, attempt limit, resubmission and release mode can change.
  Fixing a typo in a question needs a new assignment.
- **Deterministic grades are held back.** A final deterministic grade is not shown to the student until faculty
  finalize or return it.
- **Faculty pages are lightly verified.** `docs/BUILD_STATUS.md` records that browser rendering of the faculty
  grading, authoring and analytics pages with seeded data had not been verified by their authors, and that
  `/api/faculty/copilot` and `/policy-test` were written after the form; check them by hand (the demo script in
  the README does).

## Practice and retrieval

- **Practice coding items are not executed.** Nothing in `src/server/domain/practice` calls the runner. Coding,
  short-answer and explain items are graded by the model when it is available; otherwise (including when the AI call
  fails) the student is asked to self-assess against the model answer, and only then is `practice_answered` emitted.
- **pgvector retrieval is unproven without a key.** In mock mode, and for a course with no embeddings, retrieval uses
  Postgres full-text search. The vector and hybrid (reciprocal-rank fusion) path needs `OPENAI_API_KEY` and the
  `embeddings` job, and has no automated test against real embeddings. The HNSW indexes and `vector(1536)` columns
  assume `text-embedding-3-small`-sized vectors; another embedding dimension needs a migration.
- **Resource upload is limited to `.md` and `.txt` up to 1 MB.** Other formats (PDF, slides, notebooks) are not
  supported. The chunker splits on markdown `#` headings only (no setext headings).
- **Resource files are not kept in object storage.** Resource content is ingested into the database; only research
  exports use the storage driver.

## Data, research and analytics

- **Large exports are built in memory.** `buildRows` in `src/server/domain/research/export.ts` reads events in batches
  of 2000 but accumulates every row, then serializes the whole file as one string and writes it in a single call.
  Exports over 5000 rows run in the worker, but a very large export can still exhaust that process's memory. Filter by
  course, assignment or date range.
- **The S3 storage driver is a stub.** `STORAGE_DRIVER=s3` throws "S3 storage is not implemented" (and fails env
  validation in production without `S3_BUCKET`). Exports can only be written to local disk (`LOCAL_STORAGE_DIR`), which
  is not backed up.
- **Analytics are only as fresh as the aggregation job.** Metrics are recomputed every 5 minutes, on demand and on first
  view. Small cohorts show "Insufficient data" below `ANALYTICS_SMALL_N_THRESHOLD` (default 5).
- **The learner model is deliberately simple.** `ltm-v1` is a rule-based estimator over evidence with three states; it is
  not a validated psychometric model, and the `TRANSFER` evidence type is reserved and unused.
- **Seed history is synthetic and anchored.** Demo events, evidence, AI conversations and submissions are generated and
  deterministic. The time anchor is stored on first seed; re-seeding reproduces the same relative dates. To refresh the
  dates, start from a fresh database.
- **Retention is report-only by default.** `RETENTION_ENFORCE=false`. Even when enforced, identity, submissions, grades,
  research and training data are reported, not removed; the institution must decide.
- **Training gates are recorded, not computed.** Nothing enters the training plane automatically; the nine gate flags are
  set by a reviewer through `src/server/domain/training` and the system only refuses to export candidates that lack them.

## Auth and platform

- **OIDC is untested against a real identity provider.** The adapter follows the standard authorization-code + PKCE
  flow and is unit-tested for mapping rules, but no real IdP round trip has been run. It links by email only when the
  ID token says `email_verified: true`; IdPs that omit the claim cannot link existing accounts by email.
- **The CSP allows inline scripts.** `next.config.ts` sends a CSP without nonces (`script-src 'self' 'unsafe-inline'`),
  so it does not stop an injected inline script. HSTS is sent in production only.
- **Client IPs are unknown without `TRUST_PROXY=true`.** Login rate limiting is then per email across all sources (a
  known email can be locked out for 15 minutes), and audit rows carry no IP.
- **Rate limiting covers login and AI only.** The login limiter falls back to a per-process counter when Redis is down.
- **Redis and Postgres in `docker-compose.yml` have default or no credentials.** Their ports are published on
  `127.0.0.1` only. Development only. (Existing containers keep their old binding until recreated with
  `docker compose up -d --force-recreate postgres redis`.)
- **`npm audit` reports 9 high-severity findings** (4 with `--omit=dev`) through the Prisma CLI (`deepmerge-ts`,
  `mysql2`) and `eslint-config-next` (`braces`, `micromatch`, `fast-glob`). The suggested fix downgrades Prisma to 6.x
  and is not compatible. See SECURITY.md.
- **No email, notifications or password reset.** Local accounts are for seeded or pilot users; SSO is the intended
  production sign-in.

## Development and testing

- **`npm run db:reset` needs a human.** Prisma refuses `prisma migrate reset --force` when it detects an AI coding
  agent unless the user gives explicit consent. Run it yourself in a terminal. (`db:reset` is `prisma migrate reset --force`;
  run `npm run db:seed` afterwards if the seed did not run.)
- **End-to-end coverage is small.** `tests/e2e/auth.spec.ts` has 5 sign-in and access tests. The student workspace,
  Socra, grading and research flows are covered by unit and integration tests, not by browser tests. Playwright's
  Chromium must be installed once (`npx playwright install chromium`); it was not installed when the foundation was
  built.
- **Integration tests need Docker.** They use a `<db>_test` database on the compose Postgres, and the runner tests need
  the sandbox images (`npm run runner:pull`).
- **Developed and checked on Windows 11 with Docker Desktop.** Latency figures above come from that setup. Linux and
  macOS are expected to work (CI runs on Ubuntu) but were not the main development target. CI does not build the
  sandbox images, so the container-backed runner tests skip themselves there when the images are missing.
- **Environment variables not in `.env.example`:** `DOCKER_BIN` (docker executable path, default `docker`),
  `WORKER_HEALTH_HOST` (host the admin health page uses to reach the worker, default `127.0.0.1`), `E2E_USE_BUILD`
  (Playwright runs against `npm run start`) and `CI`. They are optional.

## Authoring copilot
- Copilot suggestions do not include a reference solution. Faculty must write one in the question's "Reference solution" field before closing the assignment, otherwise post-assessment Review Mode honestly reports that no reference solution is available.
- Suggested topic slugs that do not match an existing course topic are dropped (topics must exist in the course's curriculum graph). Add the topic to the course first if it is genuinely new.
