# Security

This document describes the controls that exist in the code today and the work required before real students use the
system. It is accurate to the repository at the time of writing; each control names the file that enforces it.
See also [ARCHITECTURE.md](ARCHITECTURE.md) and [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## 1. Authentication

### Sessions (`src/server/auth/session.ts`)

- Cookie `socra_session`: a random 32-byte token (base64url). Flags: `httpOnly`, `SameSite=Lax`, `path=/`, and
  `Secure` whenever `NODE_ENV=production` (`secureCookiesEnabled()` in `session.ts`). The only exception is a production
  build served over plain `http://localhost` / `127.0.0.1` (`npm run start`, E2E). A production deployment with a
  non-loopback `http://` `APP_URL` still sets `Secure`, so sign-in fails closed rather than sending the session in
  cleartext. The OIDC flow cookie uses the same rule.
- The database stores only `HMAC-SHA256(token, SESSION_SECRET)`. The raw token never touches the database, so a
  database read alone cannot be replayed as a session. Rotating `SESSION_SECRET` invalidates every session.
- Absolute expiry is `SESSION_TTL_HOURS` (default 12). `lastSeenAt` is refreshed at most every 5 minutes. Sessions
  are rejected when expired, revoked or when the user is inactive. Logout revokes the row.
- Sessions are validated server-side in every layout, page and route handler. `src/proxy.ts` only redirects
  cookie-less requests to `/login` and is explicitly not an authorization boundary (it also skips `/api`).

### Passwords (`password.ts`, `local-provider.ts`)

- bcrypt through `bcryptjs`, cost factor 12 for application-created hashes. (The seed uses cost 10 for speed.)
- Unknown accounts still run a bcrypt comparison against a dummy hash to reduce timing-based user enumeration.
- Login error responses do not distinguish unknown user from wrong password (`401 invalid_credentials`). Failed and
  successful logins are audited (`auth.login_failed`, `auth.login`).
- `AUTH_LOCAL_ENABLED=false` disables password login entirely. Do this once SSO is live. The seeded accounts all share
  the password `socra-dev-password`: they must never exist in a production database.

### CSRF and origin check (`src/server/http.ts`)

- Defence is `SameSite=Lax` plus `assertSameOrigin(req)` on mutating handlers. For non-GET methods the `Origin` (or
  `Referer`) must equal the origin of `APP_URL` or of the request `Host`. `X-Forwarded-Host` / `X-Forwarded-Proto` are
  considered only when `TRUST_PROXY=true`.
- A request with neither header is rejected in production (`403 csrf_origin_missing`) and allowed outside production so
  `curl` works in development.
- There are no CSRF tokens. Set `TRUST_PROXY=true` only behind a reverse proxy that overwrites the forwarded headers
  (default `false`: they are ignored).

### Rate limits

- Login: fixed window per `ip + email`, `RATE_LIMIT_LOGIN_PER_15_MIN` (default 20) per 15 minutes, plus a per-IP window
  of five times that across all emails when the IP is known, in Redis (`INCR` + `PEXPIRE`). If Redis is down it falls back to an in-process counter so login keeps working in degraded mode
  (the in-process counter is per-instance and resets on restart).
- The client IP comes from the first `X-Forwarded-For` entry, then `X-Real-IP`, and only when `TRUST_PROXY=true`
  (`clientIp()` in `src/server/http.ts`). Without a trusted proxy the IP is unknown (route handlers have no socket
  address): the login limit is then per email across all sources, and audit rows have no IP. A side effect is that
  anyone can exhaust the window for a known email (a 15-minute sign-in lockout for that account).
- AI: per-user per-minute limit (`AI_RATE_LIMIT_PER_MINUTE`, default 12), per-session turn cap
  (`AI_MAX_TURNS_PER_SESSION`), per-user daily cap (`AI_MAX_TURNS_PER_USER_DAY`), per-course budget and a kill switch
  (`src/server/domain/socra/budget.ts`).
- No general API rate limit exists beyond these.

### OIDC adapter (`src/server/auth/oidc-provider.ts`)

- Authorization code flow with PKCE (S256), `state` and `nonce`, through `openid-client` v6. The flow state is kept in
  an HMAC-signed, httpOnly cookie (`socra_oidc_flow`) with a 10-minute lifetime, verified with a timing-safe compare.
- The post-login redirect is restricted to same-site relative paths (`safeNextPath`).
- Mapping order: an existing `(issuer, sub)` identity; otherwise, only when the ID token carries
  `email_verified === true`, link by email to an existing user; otherwise create a STUDENT only if
  `OIDC_AUTO_PROVISION=true` and the email is verified; otherwise deny. An unverified or missing email is never used,
  so such a subject can sign in only through an existing `(issuer, sub)` identity. Only `sub` and the configured email
  claim are stored.
- The adapter returns 503 with an explanation until `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and
  `OIDC_REDIRECT_URI` are all set.
- Caveat: some identity providers (for example some Microsoft Entra ID configurations) do not send `email_verified`.
  With those, first sign-in by email is refused; pre-link identities or confirm the IdP emits the claim. Linking trusts
  the IdP's assertion: the IdP must only mark institution-controlled addresses as verified.
- The flow has not been exercised against a real identity provider (see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)).

### Response headers (`next.config.ts`)

Set for every route in `next.config.ts`:

- `Content-Security-Policy`: `default-src 'self'`; `script-src 'self' 'unsafe-inline'` (plus `'unsafe-eval'` in
  development only, for React Refresh); `style-src 'self' 'unsafe-inline'`; `img-src 'self' data: blob:`;
  `font-src 'self'` (next/font self-hosts); `connect-src 'self'` (plus `ws:`/`wss:` in development for HMR);
  `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`; `frame-ancestors 'none'`; `frame-src 'none'`.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Cross-Origin-Opener-Policy: same-origin`, and a `Permissions-Policy` that disables camera, microphone, geolocation,
  payment, USB, serial, Bluetooth, motion sensors and Topics.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains` when `NODE_ENV=production` (browsers ignore it over
  plain http, so a local `npm run start` is unaffected).
- `X-Powered-By` is removed.

Residual: the CSP has no nonces, so `script-src` allows inline script. It blocks foreign script, style, font and connect
origins, plugins, `<base>` rewrites, foreign form targets and framing, but it is not a defence against an injected
inline script. A nonce-based policy needs the proxy to mint a nonce per request and makes every page dynamic.

## 2. Authorization (RBAC)

All decisions go through `can()` / `assertCan()` in `src/server/auth/rbac.ts`. They are pure functions over a
`Principal` (roles, active memberships, privileged grants). UI visibility is never the boundary: every handler and
server component calls them. Denials return 403 (401 when unauthenticated).

Model:

- Global roles on the user (`STUDENT`, `TA`, `INSTRUCTOR`, `RESEARCH_ADMIN`, `SYSTEM_ADMIN`) and a per-course
  `CourseMembership.role` (`STUDENT`, `TA`, `INSTRUCTOR`). Course-scoped permissions check the active membership role,
  never the global role alone.
- Three rule kinds: course rules (role in the course), own-resource rules (caller must be the owner and an active
  course member), and global-role rules.
- `SYSTEM_ADMIN` has a narrow course override: `course:read`, `course:roster:manage`, `assignment:read_staff`,
  `assignment:close`, `assignment:reopen`. It gives no grading, hidden-test or faculty-analytics access.

Permissions (`PERMISSIONS`) and who holds them:

| Permission                                                                                              | Holder                                                |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `course:read`, `assignment:read`, `resource:read`, `code:run`                                           | Any active course member                              |
| `draft:read_own`, `submission:read_own`, `grade:read_own`, `socra:history:read_own`                      | Owner, course member                                  |
| `draft:write_own`, `submission:create_own`, `learner_profile:read_own`                                   | Owner, STUDENT in the course                          |
| `socra:use`, `practice:use`                                                                              | STUDENT in the course                                 |
| `assignment:read_staff`, `assignment:preview`, `assignment:hidden_tests:read`, `submission:read_course`, `grade:write`, `escalation:read`, `analytics:course:read` | TA or INSTRUCTOR in the course |
| `assignment:create`, `assignment:update`, `assignment:publish`, `assignment:close`, `assignment:reopen`, `assignment:release_solutions`, `grade:finalize`, `grade:override`, `analytics:individual:read`, `resource:manage`, `authoring:ai`, `analytics:ai_brief`, `course:roster:manage` | INSTRUCTOR in the course |
| `course:manage`, `admin:flags:manage`, `admin:ai_config:manage`, `admin:ai_usage:read`, `admin:audit:read`, `admin:jobs:read`, `admin:health:read`, `admin:users:manage`, `admin:roles:manage`, `admin:grants:manage` | SYSTEM_ADMIN |
| `research:read`, `research:export`, `research:condition:manage`                                          | RESEARCH_ADMIN                                        |
| `transcript:read_raw`                                                                                    | SYSTEM_ADMIN or RESEARCH_ADMIN with an active grant and a reason (section 3) |

`canAccessArea` gates the layouts (`student`, `faculty`, `admin`, `research`); handlers still call `can()`. Unit tests
for the policy are in `tests/unit/rbac.test.ts`.

### Authorization review (2026-10-06)

Every handler under `src/app/api/**` was checked for authentication, server-side RBAC scoped by course membership or
ownership, `assertSameOrigin` on mutating methods, zod input validation and response content.
`tests/integration/security-authz.test.ts` drives the real route handlers with session cookies across two courses and
asserts the cross-course and cross-student denials (assignment edit/publish/close/release, grading list/finalize/AI
suggestion, analytics, resources, drafts, runs, Socra sessions and messages, practice sessions, learner profile, raw
transcripts, CSRF origin and forwarded-header handling).

Findings fixed:

| Finding | Fix |
| ------- | --- |
| A system admin could grant `TRANSCRIPT_READ_RAW` to themselves and then read any transcript with no second approver | `createPrivilegedGrant` (`src/server/domain/admin/roles.ts`) refuses self-grants (`409 self_grant`) |
| OIDC linked an IdP subject to an existing account by email without `email_verified`, allowing account takeover through an IdP that accepts self-asserted emails | `mapOidcSubject` (`src/server/auth/oidc-provider.ts`) uses the email only when `email_verified === true` |
| `X-Forwarded-For` / `X-Forwarded-Host` were always trusted: clients could rotate IPs to bypass the login rate limit, forge audit IPs and widen the CSRF host allowlist | Honoured only with `TRUST_PROXY=true` (`src/server/http.ts`, `src/server/env.ts`) |
| Session cookie was not `Secure` in production unless `APP_URL` started with `https://` | `Secure` in production except plain-http loopback (`secureCookiesEnabled()`) |
| `POST /api/faculty/copilot` accepted an `assignmentId` from another course and recorded it on the AI request | `suggestAssignmentContent` (`src/server/domain/authoring-ai/index.ts`) requires the assignment to belong to the authorized course |
| Unauthenticated `GET /api/health` returned the database driver's error text (host and port) | The route drops `checks.database.error`; admins still see it in `/admin/health` |
| Code-run job payloads (code and hidden-test expectations) stayed in Redis about 5 minutes after completion and 1 hour after failure | Removed by the waiter immediately; 60 s age otherwise; event stream capped |
| Compose published Postgres and Redis (no password) on all interfaces | Bound to `127.0.0.1` |
| No CSP or HSTS | Added in `next.config.ts` (see above) |

No cross-course or cross-student read or write was found in the route handlers: each domain function loads the target
row, derives its `courseId` and calls `assertCan` (or compares `userId` and answers 404) before returning data.

Residual risks found during the review (not changed here):

- `generateMetadata` in `src/app/(student)/courses/[courseId]/assignments/[assignmentId]/page.tsx` reads the assignment
  title by id without an access check, so any signed-in user who knows an id can see a draft assignment's title in the
  page `<title>`. Ids are random cuids; fix by resolving the title through `getAssignmentForStudent`.
- `PUT /api/resources/:id` parses the body before the `resource:manage` check, and several handlers answer 404 for a
  missing id but 403 for an existing id in another course. This reveals that an id exists, not its content.
- `TRANSCRIPT_READ_RAW` grants are global, not scoped to a course or study.
- A system admin can still give a second account an admin role and then approve their own grant through it; the role
  change and the grant are both audited (`role.change`, `grant.create`). Review admin accounts and grants together.
- Instructors can roster-import any existing account (by email) into their own course with any course role. This gives
  rights only inside that course.

## 3. Raw transcript access

Raw Socra conversations are the most sensitive data in the system. Faculty analytics, the aggregation job and research
exports never select `AiMessage.content`.

`transcript:read_raw` is denied unless all of the following hold (`authorize()` in `rbac.ts`):

1. The user has the role `SYSTEM_ADMIN` or `RESEARCH_ADMIN`. `INSTRUCTOR` and `TA` never qualify, regardless of course
   role.
2. An unexpired, unrevoked `PrivilegedAccessGrant(TRANSCRIPT_READ_RAW)` exists for the user. Grants are created and
   revoked by a system admin (`grant.create`, `grant.revoke`, both audited).
3. A reason of at least 10 characters is supplied (`GET /api/socra/transcripts/:sessionId?reason=...`).

Grants are issued with separation of duties: `createPrivilegedGrant` refuses a grant whose holder is the issuing admin
(`409 self_grant`), so raw access always needs a second administrator. A grant is global (not scoped to a course or
participant); keep grants short and review them.

`readRawTranscript` (`src/server/domain/socra/sessions.ts`) then writes an `AuditLog` row (`transcript.read_raw`) and a
`TranscriptAccessLog` row in one transaction before returning content. Students read only their own sessions through
`/api/socra/sessions/:id`.

## 4. Code execution sandbox

Student code is untrusted. It runs only in a throwaway container started by the worker, never in the Next.js process.
The command line is built by `buildDockerRunArgs` in `src/server/runner/docker-args.ts` and asserted by unit tests:

| Flag                                       | Effect                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| `--rm`                                     | Container removed on exit                                                      |
| `--network none`                           | No network, including no metadata or internal services                         |
| `--memory <RUNNER_MEMORY>` and `--memory-swap` equal | Hard memory cap, swap disabled, so overuse is an OOM kill (exit 137)      |
| `--cpus <RUNNER_CPUS>`                     | CPU cap (Scala is raised to at least 768m and 1 CPU)                           |
| `--pids-limit <RUNNER_PIDS_LIMIT>`         | Fork-bomb limit                                                                |
| `--read-only`                              | Read-only root filesystem                                                      |
| `--tmpfs /tmp` (64m) and `--tmpfs /work` (32m), `exec`, mode 1777 | Only writable locations, size capped, wiped on exit      |
| `--cap-drop ALL`                           | No Linux capabilities                                                          |
| `--security-opt no-new-privileges`         | No privilege escalation through setuid binaries                                |
| `--user 65534:65534`                       | Unprivileged `nobody` user                                                     |
| `-i`                                       | Code and harness arrive on stdin                                               |

Also: no `-e` flags, no `--env-file`, no bind mounts, no Docker socket in the container. The host enforces a wall-clock
timeout (`RUNNER_TIMEOUT_MS`, Scala `RUNNER_SCALA_TIMEOUT_MS`) and kills the container, and caps collected output at
`RUNNER_OUTPUT_LIMIT_BYTES`. Test expectations are compared on the host, and function-test results travel
out of band so printed output cannot forge a pass.

### Threat model

| Threat                                           | Mitigation                                                                                     | Residual risk |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------- |
| Student reads hidden tests or the reference solution | Expected values never enter the container; the container holds only the student's code and the harness | Low |
| Network exfiltration or scanning                 | `--network none`                                                                               | Low           |
| CPU, memory, disk or fork exhaustion             | Memory, CPU, pids, tmpfs size, output and wall-clock limits; queue concurrency `RUNNER_CONCURRENCY` | Low to medium: many concurrent runs can still load the host |
| Reading host files or secrets                    | No bind mounts, no environment, read-only root, dropped caps, non-root user                    | Low           |
| Container escape through a kernel or runtime bug | Standard Docker isolation only                                                                 | **Real.** Containers share the host kernel. See the hardening note |
| Compromise of the worker host                    | The worker needs access to the Docker daemon, which is effectively root on that host           | **Real.** Run the worker on a dedicated, minimal host |
| Forged results through stdout                    | Out-of-band, nonce-tagged result channel                                                       | Low           |
| Job payload exposure in Redis                    | The waiter deletes the job as soon as it has the result; otherwise jobs expire 60 s after completion or failure (`CODE_RUN_JOB_RETENTION_S`), and the `code-runs` event stream is capped at about 200 entries | Low; Redis must still be private and authenticated in production |

The `docker-compose.yml` Redis has no password; its port 6390 (and Postgres 5544) is published on `127.0.0.1` only.
That is acceptable for local development only. The `app` image in the `Dockerfile` does not contain the Docker CLI, so the containerized worker
cannot launch sandboxes; with the `docker` driver, code execution needs the worker on a host that has Docker (the Vercel deployment uses the `vercel-sandbox` driver below instead).

### Vercel Sandbox driver (`CODE_RUNNER_DRIVER=vercel-sandbox`)

Used on the Vercel deployment, which has no Docker. Each run gets a fresh Vercel Sandbox (a Firecracker microVM) that
is stopped in a `finally` and also has a lifetime cap, so nothing is shared between runs or students.

| Control                                          | Effect                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| One microVM per run, `persistent: false`         | Hardware-virtualized isolation with its own kernel; no filesystem survives the run |
| `networkPolicy: "deny-all"`                      | No egress at all; DNS fails too (checked by the live integration test)            |
| No `env` on `Sandbox.create` or `runCommand`     | No app secrets enter the VM. The student process starts under `env -i` with only `PATH`, `HOME`, `LANG` and the Python flags of the Docker image |
| Student code runs as uid/gid 65534 via `sudo -u` | The VM's default user has passwordless sudo; uid 65534 does not (verified)       |
| `/opt/socra` root-owned 0755, files 0644         | The student cannot change the bootstrap or harness                               |
| `payload.json` 0600, owned by the setup user     | Delivered on stdin through a shell redirect; holds code and args only, never expected values |
| `ulimit -u RUNNER_PIDS_LIMIT`, `ulimit -f` 64 MB | Fork-bomb and file-size limits                                                   |
| Watchdog, SDK `timeoutMs`, host abort            | Wall-clock limit; the watchdog kills every uid-65534 process, orphaned children included |
| Host-side output cap                             | The command is aborted once `RUNNER_OUTPUT_LIMIT_BYTES` is exceeded              |

Differences from Docker: there is no per-run memory or CPU quota inside the VM (`RUNNER_MEMORY` and `RUNNER_CPUS` do
not apply); the bound is the VM itself (1 vCPU, 2 GB). An OOM kill before the deadline still reports
`MEMORY_LIMIT`. The OIDC token stays in the web process, where the SDK uses it for API calls only. Hidden-test
expectations never leave the web process; they are compared host-side exactly as with Docker. Residual risk: the
web function's OIDC token can create sandboxes for the project, so sandbox cost and abuse are bounded by the app's
own authorization and rate limits on `/api/runs` and by the Vercel plan's sandbox limits.

`CODE_RUNNER_DRIVER=remote` delegates to an HTTP sandbox service (contract in `src/server/runner/remote-runner.ts`).
The job body contains hidden test expectations, so `REMOTE_RUNNER_URL` must be a trusted TLS endpoint. This driver has not been exercised against a real service.

## 5. Hidden-test protection

Hidden and diagnostic tests (`TestVisibility.HIDDEN`) must never reach a student or a model. Enforcement points:

1. **Loading**: only `src/server/runner` and `src/server/domain/grading` may load hidden cases
   (`src/server/runner/types.ts`).
2. **Student queries**: `src/server/domain/assignments/queries.ts` uses explicit `select` clauses that never include
   hidden or diagnostic tests, answer keys or (outside review mode) reference solutions, so a later schema field cannot
   leak by accident.
3. **Run results**: `toStudentRunResult` strips hidden and diagnostic results and their messages. Top-level
   `stdout`/`stderr` in tests mode contain public test output only.
4. **Container**: expected values are compared on the host and are not present in the container.
5. **AI context**: `PROTECTED_ASSESSMENT` context rules set `hiddenTests: false` and `referenceSolution: false`;
   `getWorkspaceContextForAi` passes public test output only.
6. **AI output**: `checkProtectedOutput` (`src/server/ai/policy-check.ts`) loads hidden-test material server-side and
   blocks replies that name a hidden test, contain distinctive hidden inputs or expected values, overlap the reference
   solution, or define the target function. This check is heuristic (see [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md)).
7. **Faculty preview**: the staff preview reads and writes no student data and emits no events.
8. **Integration test**: `tests/integration/assignments-submissions.test.ts` asserts hidden-test non-leakage.

## 6. Secrets handling

- `OPENAI_API_KEY`, `OIDC_CLIENT_SECRET`, `S3_SECRET_ACCESS_KEY`, `REMOTE_RUNNER_TOKEN`, `SESSION_SECRET` and
  `RESEARCH_PSEUDONYM_SECRET` are read only in server code (`src/server/env.ts`, files marked `import "server-only"`).
  None uses a `NEXT_PUBLIC_` name, so none is bundled to the browser.
- `.env`, `.env.local` and `.env.*.local` are git-ignored; only `.env.example` is committed and it contains
  development placeholders only. `storage/` (research exports) is also ignored.
- In production the app refuses to start without `SESSION_SECRET` (at least 32 characters), `RESEARCH_PSEUDONYM_SECRET`,
  `DATABASE_URL` and `REDIS_URL`. Outside production it falls back to development defaults with a warning. The
  development defaults in `.env.example` are public: never reuse them.
- The sandbox receives no environment at all. The Docker CLI is spawned with an allowlisted environment (`PATH`, Docker host/config variables, home and temp directories), so app secrets are not inherited by it.
- Event metadata is screened for forbidden keys (content, code, prompt, token, email, referenceSolution and similar);
  an event that contains one is quarantined and never dispatched. Research exports can only contain allowlisted fields.
- Rotating `RESEARCH_PSEUDONYM_SECRET` changes every participant pseudonym. Decide the value before any real export and
  store it in a secrets manager; losing it makes earlier exports unlinkable to new ones.

## 7. Privacy domain separation

Data is classed by `PrivacyClass` (`IDENTITY`, `EDUCATIONAL_RECORD`, `SENSITIVE_CONVERSATION`, `AGGREGATE`,
`RESEARCH_PSEUDONYMOUS`, `MODEL_TRAINING_CURATED`, `OPERATIONAL`) and `RetentionClass`, and the four planes in
[ARCHITECTURE.md](ARCHITECTURE.md#4-the-four-data-planes) have different access rules.

- Faculty see aggregates with small-n suppression (`ANALYTICS_SMALL_N_THRESHOLD`, default 5) and the learner profile
  data they are permitted by `analytics:individual:read`. They never see raw chats.
- Research exports are pseudonymous (`p_` + HMAC), only for consenting participants, built from an explicit field
  allowlist (`src/server/domain/research/allowlist.ts`). Names, emails, internal ids, session ids, raw messages, code
  and answers cannot be requested. CSV output is protected against formula injection. See
  [RESEARCH_DATA_DICTIONARY.md](RESEARCH_DATA_DICTIONARY.md).
- Participants who withdraw or decline consent are excluded from exports.
- The identity-to-pseudonym mapping lives only in `ResearchParticipantMapping`.
- Model-improvement data is a separate, opt-in plane: nothing enters automatically, and a candidate needs nine passed
  gates plus approval. Held-out evaluation items are excluded from training.
- OpenAI requests are sent with `store: false`. Student identifiers are not placed in prompts; the envelope carries
  internal ids for logging, but the prompt builders use assignment, workspace and conversation content only.

## 8. Audit, append-only tables and retention

### Audit events

`writeAudit` (`src/server/audit/index.ts`) records the actor, action, target, course, reason, metadata, IP and user
agent, in the same transaction as the privileged change where possible. Actions in use include `auth.login`,
`auth.login_failed`, `auth.logout`, `assignment.create|update|publish|close|reopen|archive|solutions_release`,
`grade.finalize`, `grade.override`, `role.change`, `roster.import`, `course.create|update|staff_add|staff_remove`,
`grant.create|revoke`, `flag.update`, `ai_config.update`, `ai_budget.update`, `research.condition_assign|condition_change`,
`research.export_requested|export|export_download|export_failed`, `training.dataset_export`, `retention.run`,
`resource.archive`, `jobs.outbox_retry`, `jobs.failure_resolve` and `transcript.read_raw`. System admins read them at
`/admin/audit`.

### Append-only triggers (migration `20261006064100_search_indexes_and_guards`)

| Table             | Rule                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `AuditLog`        | No UPDATE. DELETE only during a retention purge                                              |
| `HeldOutEvalItem` | No UPDATE. DELETE only during a retention purge                                              |
| `AnalyticsEvent`  | Only `status` and `quarantineReason` may change. DELETE only during a retention purge        |
| `LearningEvidence` | Only `invalidatedAt` and `invalidationReason` may change. DELETE only during a retention purge |

A retention purge is a transaction that first runs `SELECT set_config('socra.retention_purge','on',true)`. Anyone with
direct database write access and the ability to set that parameter can bypass the guards, so database credentials must
be tightly held.

### Retention (`src/server/domain/retention/index.ts`)

Policies come from `RetentionPolicy` rows (admin-editable) over the `RETENTION_*_DAYS` environment defaults. The job
reports what it would do and applies nothing unless `RETENTION_ENFORCE=true`. When enforced: raw AI message content is
redacted (default 365 days), AI request logs, expired sessions, processed outbox rows and old audit rows are deleted.
Identity, submissions, grades, research and training data are report-only: they need an institutional decision.
The shipped values are placeholders and must be approved before launch.

## 9. Before real students use this

Work through this list before a pilot with real student data. None of it is done by the repository.

- [ ] **TLS and proxy.** Serve only over HTTPS (reverse proxy or platform) and set `APP_URL` to the https URL. The app
      sends HSTS and a CSP itself in production; check that the proxy does not strip or duplicate them. Make the proxy
      overwrite `X-Forwarded-For`, `X-Forwarded-Host` and `X-Forwarded-Proto`, then set `TRUST_PROXY=true`.
- [ ] **Secrets.** Generate fresh values: `SESSION_SECRET` (for example `openssl rand -hex 32`),
      `RESEARCH_PSEUDONYM_SECRET`, database and Redis passwords. Keep them in a secrets manager, not in files.
      Never reuse the values in `.env.example`. Plan a rotation procedure (`SESSION_SECRET` rotation signs everyone out).
- [ ] **Remove demo data.** Do not run the seed in production. The seeded accounts share a known password. Create
      real accounts through SSO or roster import.
- [ ] **OIDC.** Configure the campus identity provider (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
      `OIDC_REDIRECT_URI` matching the registered callback). Test sign-in end to end with a real account, confirm the
      email claim is verified, decide `OIDC_AUTO_PROVISION`, then set `AUTH_LOCAL_ENABLED=false`.
- [ ] **Backups and restore.** Back up Postgres (including the pgvector data) on a schedule, and actually perform a
      restore into a clean environment and run the app against it. Back up the research export directory or move to
      object storage (the S3 driver is a stub).
- [ ] **Dependency audit.** `npm audit` currently reports 9 high-severity findings (4 when limited to
      `--omit=dev`). They are `deepmerge-ts` and `mysql2` pulled in by the Prisma CLI (`prisma`, `@prisma/config`), and
      `braces` / `micromatch` / `fast-glob` pulled in by `eslint-config-next`. The application uses PostgreSQL, not
      MySQL, and the ESLint chain is development tooling, so these are not obviously reachable at runtime, but confirm
      that, track upstream fixes (`npm audit fix --force` would downgrade Prisma to 6.x, which is not compatible with
      this code), and re-run `npm audit` before launch and on a schedule.
- [ ] **Docker host hardening.** Run the worker on a dedicated host or VM with nothing else on it. Keep Docker
      patched. Consider a stronger isolation runtime (gVisor `runsc`, Kata, Firecracker microVMs) or the remote runner
      driver backed by one. Keep the Docker daemon socket unreachable from anything but the worker. Consider
      `--userns-remap` and an egress-deny host firewall.
- [ ] **Redis and Postgres exposure.** Bind both to private networks, require passwords and TLS where available, and
      do not publish their ports. Compose publishes 5544 and 6390 on loopback for development only.
- [ ] **OpenAI organization settings.** Use a dedicated organization or project. Confirm data retention and
      training-use settings with your institution's agreement. The app sends `store: false`, but verify the
      organization-level data controls, zero-data-retention eligibility and abuse-monitoring retention yourself.
      Set spend limits at OpenAI as well as `AI_COURSE_BUDGET_USD`.
- [ ] **IRB and FERPA.** Obtain IRB approval for the study and for any use of student conversations. Complete a FERPA
      review: what is an education record, who may access it, the consent flow for research participation, withdrawal
      handling and the retention schedule. Finalize and approve every `RETENTION_*_DAYS` value and set
      `RETENTION_ENFORCE` deliberately.
- [ ] **Run the policy check against real assignments.** The output check is a heuristic safeguard, not a guarantee.
      Use the faculty policy test on each assignment, and tell students and faculty what Socra can and cannot promise.
- [ ] **Monitoring and incident response.** Collect application and worker logs, alert on `/api/health`, the worker
      `/health` outbox depth and failed jobs (Admin > Jobs), and define who responds and how a suspected transcript
      access or leak is handled.
- [ ] **Access reviews.** Review privileged transcript grants and admin accounts on a schedule; keep grants short-lived.
- [ ] **Load and abuse testing.** The limits above were set for a small pilot. Test concurrent runs, AI traffic and the
      outbox under realistic load before the first graded assignment.
