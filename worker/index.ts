/**
 * Socra background worker (separate process; never the Next.js server).
 *
 *  - Loads .env.local then .env (same precedence as Next.js).
 *  - Outbox dispatcher loop (OUTBOX_POLL_INTERVAL_MS) -> registered consumers (src/server/events/consumers).
 *  - BullMQ workers for code-runs, embeddings, aggregation, exports, retention, grading, learner.
 *    Domain agents register processors in worker/processors.ts.
 *  - Health server on WORKER_HEALTH_PORT: GET /health -> { status, db, redis, queues, outbox }.
 *  - Graceful shutdown on SIGINT/SIGTERM.
 */
import "./load-env";
import { createServer, type Server } from "node:http";
import { Worker, type Job } from "bullmq";
import type { Prisma } from "@/generated/prisma/client";
import { disconnectPrisma, prisma } from "@/server/db";
import { checkDatabase } from "@/server/health";
import { env } from "@/server/env";
import { defaultWorkerId, dispatchOnce, outboxDepth } from "@/server/events/dispatcher";
import "@/server/events/consumers";
import { getConsumers } from "@/server/events/consumers/registry";
import { closeQueues, getQueue, QUEUE_NAMES, type QueueName } from "@/server/queues";
import { bullConnection, disconnectRedis, pingRedis } from "@/server/redis";
import { processors } from "./processors";
import "./jobs/aggregate"; // Agent D: aggregation + learner queues, 5-min schedule
import "./jobs/retention"; // Agent D: retention queue, daily dry-run schedule

const workers: Worker[] = [];
let stopping = false;
let outboxTimer: NodeJS.Timeout | undefined;
let lastOutboxTick: { at: string; claimed: number; error?: string } | undefined;
let healthServer: Server | undefined;

function log(msg: string, extra?: unknown) {
  const line = `[worker] ${new Date().toISOString()} ${msg}`;
  if (extra !== undefined) console.info(line, extra);
  else console.info(line);
}

// ---------------------------------------------------------------------------
// Outbox loop
// ---------------------------------------------------------------------------
async function outboxTick(): Promise<void> {
  if (stopping) return;
  try {
    let claimed = 0;
    // Drain in batches while there is work, then sleep.
    for (let i = 0; i < 20 && !stopping; i++) {
      const s = await dispatchOnce({ workerId: defaultWorkerId });
      claimed += s.claimed;
      if (s.claimed === 0) break;
    }
    lastOutboxTick = { at: new Date().toISOString(), claimed };
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    lastOutboxTick = { at: new Date().toISOString(), claimed: 0, error: message };
    console.error("[worker] outbox tick failed:", message);
  } finally {
    if (!stopping) outboxTimer = setTimeout(outboxTick, env().OUTBOX_POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// BullMQ workers
// ---------------------------------------------------------------------------
async function recordJobFailure(queue: string, job: Job | undefined, err: Error) {
  try {
    await prisma.backgroundJobFailure.create({
      data: {
        queue,
        jobName: job?.name ?? "unknown",
        jobId: job?.id ?? null,
        payload: (job?.data ?? undefined) as Prisma.InputJsonValue | undefined,
        error: err.message.slice(0, 4000),
        stack: err.stack?.slice(0, 8000) ?? null,
        attempts: job?.attemptsMade ?? 0,
      },
    });
  } catch (e) {
    console.error("[worker] could not record job failure", e);
  }
}

function startQueueWorkers() {
  const concurrency: Partial<Record<QueueName, number>> = {
    [QUEUE_NAMES.codeRuns]: env().RUNNER_CONCURRENCY,
  };
  for (const name of Object.values(QUEUE_NAMES)) {
    const processor = processors[name];
    const worker = new Worker(
      name,
      async (job) => {
        if (!processor) {
          throw new Error(`No processor registered for queue "${name}" (job ${job.name})`);
        }
        return processor(job);
      },
      { connection: bullConnection(), concurrency: concurrency[name] ?? 2, autorun: true },
    );
    worker.on("failed", (job, err) => {
      const finalAttempt = !job || job.attemptsMade >= (job.opts.attempts ?? 1);
      if (finalAttempt) void recordJobFailure(name, job, err);
    });
    worker.on("error", (err) => console.error(`[worker] queue ${name} error:`, err.message));
    workers.push(worker);
  }
  log(`queue workers started: ${Object.values(QUEUE_NAMES).join(", ")}`);
}

// ---------------------------------------------------------------------------
// Health server
// ---------------------------------------------------------------------------
async function queueDepths(): Promise<Record<string, Record<string, number>>> {
  const out: Record<string, Record<string, number>> = {};
  await Promise.all(
    Object.values(QUEUE_NAMES).map(async (name) => {
      try {
        out[name] = await getQueue(name).getJobCounts("waiting", "active", "delayed", "failed");
      } catch {
        out[name] = {};
      }
    }),
  );
  return out;
}

function startHealthServer() {
  const port = env().WORKER_HEALTH_PORT;
  healthServer = createServer(async (req, res) => {
    if (req.url !== "/health" && req.url !== "/") {
      res.writeHead(404).end();
      return;
    }
    const [db, redisOk] = await Promise.all([checkDatabase(), pingRedis()]);
    const [queues, outbox] = await Promise.all([
      redisOk ? queueDepths() : Promise.resolve({}),
      db.ok ? outboxDepth().catch(() => ({})) : Promise.resolve({}),
    ]);
    const status = !db.ok ? "down" : redisOk ? "ok" : "degraded";
    const body = {
      status,
      service: "socra-worker",
      appVersion: env().APP_VERSION,
      time: new Date().toISOString(),
      db,
      redis: { ok: redisOk },
      queues,
      outbox: { depth: outbox, lastTick: lastOutboxTick },
      consumers: getConsumers().map((c) => c.name),
      processors: Object.keys(processors),
    };
    res.writeHead(status === "down" ? 503 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  healthServer.on("error", (err) => console.error("[worker] health server error:", err.message));
  healthServer.listen(port, () => log(`health server on :${port}/health`));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log(`${signal} received, shutting down`);
  if (outboxTimer) clearTimeout(outboxTimer);
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  await Promise.allSettled(workers.map((w) => w.close()));
  await closeQueues();
  await new Promise<void>((resolve) =>
    healthServer ? healthServer.close(() => resolve()) : resolve(),
  );
  await disconnectRedis();
  await disconnectPrisma();
  log("stopped");
  process.exit(0);
}

async function main() {
  const e = env();
  log(
    `starting (app ${e.APP_VERSION}, ai ${e.AI_MOCK_MODE ? "mock" : "openai"}, runner ${e.CODE_RUNNER_DRIVER})`,
  );
  startHealthServer();
  if (await pingRedis(3000)) {
    startQueueWorkers();
  } else {
    console.error(
      "[worker] Redis unreachable at startup; queue workers not started (outbox still runs). Restart the worker once Redis is up.",
    );
  }
  log(
    `outbox dispatcher every ${e.OUTBOX_POLL_INTERVAL_MS}ms (consumers: ${
      getConsumers()
        .map((c) => c.name)
        .join(", ") || "none"
    })`,
  );
  void outboxTick();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => console.error("[worker] unhandled rejection", err));

void main();
