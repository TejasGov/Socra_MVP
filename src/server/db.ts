import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { env } from "./env";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Prisma 7 client (driver adapter: @prisma/adapter-pg), one per process.
 * The global cache keeps a single pool across Next.js dev HMR reloads.
 */

export type Db = PrismaClient;
/** Interactive-transaction client passed to `prisma.$transaction(async (tx) => ...)`. */
export type Tx = Prisma.TransactionClient;
/** Anything that can run queries: the root client or a transaction client. */
export type DbOrTx = PrismaClient | Prisma.TransactionClient;

function createClient(cloudflare = false): PrismaClient {
  const url = new URL(env().DATABASE_URL);
  // `?schema=` is a Prisma convention, not a libpq parameter; pass it to the adapter instead.
  const schema = url.searchParams.get("schema") ?? undefined;
  url.searchParams.delete("schema");
  const adapter = new PrismaPg(
    {
      connectionString: url.toString(),
      max: cloudflare ? 5 : 10,
      // Workers cannot reuse a TCP socket created by another request. Close each released connection.
      ...(cloudflare ? { maxUses: 1 } : {}),
    },
    { schema },
  );
  return new PrismaClient({
    adapter,
    log: env().LOG_LEVEL === "debug" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

const globalForPrisma = globalThis as unknown as { __socraPrisma?: PrismaClient };
const requestClients = new WeakMap<object, PrismaClient>();

/** Uses a request-scoped client on Cloudflare, or the process-wide pool on Node.js. */
export function getPrisma(): PrismaClient {
  let requestContext: object | undefined;
  try {
    requestContext = getCloudflareContext().ctx;
  } catch {
    // Normal Next.js, scripts, tests and the BullMQ worker have no Cloudflare context.
  }
  if (requestContext) {
    let client = requestClients.get(requestContext);
    if (!client) {
      client = createClient(true);
      requestClients.set(requestContext, client);
    }
    return client;
  }
  if (!globalForPrisma.__socraPrisma) {
    globalForPrisma.__socraPrisma = createClient();
  }
  return globalForPrisma.__socraPrisma;
}

/**
 * Lazily-initialized client. Importing this module never opens a connection or validates env,
 * so `next build` can evaluate route modules without a database.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrisma();
    const value: unknown = Reflect.get(client, prop, client);
    return typeof value === "function"
      ? (value as (...a: unknown[]) => unknown).bind(client)
      : value;
  },
});

/** Close the pool (worker shutdown, scripts, tests). */
export async function disconnectPrisma(): Promise<void> {
  if (globalForPrisma.__socraPrisma) {
    await globalForPrisma.__socraPrisma.$disconnect();
    globalForPrisma.__socraPrisma = undefined;
  }
}
