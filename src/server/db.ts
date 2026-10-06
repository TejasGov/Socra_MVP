import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { env } from "./env";

/**
 * Prisma 7 client (driver adapter: @prisma/adapter-pg), one per process.
 * The global cache keeps a single pool across Next.js dev HMR reloads.
 */

export type Db = PrismaClient;
/** Interactive-transaction client passed to `prisma.$transaction(async (tx) => ...)`. */
export type Tx = Prisma.TransactionClient;
/** Anything that can run queries: the root client or a transaction client. */
export type DbOrTx = PrismaClient | Prisma.TransactionClient;

function createClient(): PrismaClient {
  const url = new URL(env().DATABASE_URL);
  // `?schema=` is a Prisma convention, not a libpq parameter; pass it to the adapter instead.
  const schema = url.searchParams.get("schema") ?? undefined;
  url.searchParams.delete("schema");
  const adapter = new PrismaPg({ connectionString: url.toString(), max: 10 }, { schema });
  return new PrismaClient({
    adapter,
    log: env().LOG_LEVEL === "debug" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

const globalForPrisma = globalThis as unknown as { __socraPrisma?: PrismaClient };

/** Returns the process-wide client, creating it on first use. */
export function getPrisma(): PrismaClient {
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
