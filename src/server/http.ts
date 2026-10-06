import "server-only";
import { after, NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AuthError } from "./auth/rbac";
import { env } from "./env";

/**
 * Route-handler helpers. Pattern for every handler:
 *   export const POST = route(async (req) => {
 *     assertSameOrigin(req);
 *     const input = await parseJson(req, schema);
 *     const user = await requireUser();
 *     assertCan(user, "assignment:publish", { courseId });
 *     return json(await service(...));
 *   });
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
    this.name = "HttpError";
  }
}

export function json<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export function errorResponse(
  status: number,
  code: string,
  message?: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json({ error: { code, message: message ?? code, details } }, { status });
}

export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return errorResponse(
      err.status,
      err.code,
      err.status === 401 ? "Sign in required" : "Not allowed",
    );
  }
  if (err instanceof HttpError)
    return errorResponse(err.status, err.code, err.message, err.details);
  if (err instanceof ZodError) {
    return errorResponse(
      400,
      "invalid_input",
      "Invalid input",
      err.issues.map((i) => ({ path: i.path, message: i.message })),
    );
  }
  console.error("[route] unhandled error", err);
  return errorResponse(500, "internal_error", "Something went wrong");
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wrap a route handler with uniform error mapping (AuthError -> 401/403, ZodError -> 400, HttpError -> status). */
export function route<C = unknown>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    if (env().INLINE_JOBS && req.method !== "GET" && req.method !== "HEAD") {
      // Serverless hosting has no worker process: process the outbox after this response is sent.
      after(async () => {
        const { runInlineJobs } = await import("./jobs/inline");
        await runInlineJobs();
      });
    }
    try {
      return await handler(req, ctx);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be JSON");
  }
  return schema.parse(body);
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  const url = new URL(req.url);
  return schema.parse(Object.fromEntries(url.searchParams.entries()));
}

/**
 * CSRF defense for mutating handlers: SameSite=Lax cookie + Origin/Referer must match APP_URL or the request host.
 * Requests without Origin and Referer (curl, server-to-server) are allowed only outside production.
 */
export function assertSameOrigin(req: Request): void {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = req.headers.get("origin") ?? refererOrigin(req.headers.get("referer"));
  if (!origin) {
    if (env().IS_PRODUCTION)
      throw new HttpError(403, "csrf_origin_missing", "Missing Origin header");
    return;
  }
  const allowed = new Set<string>([new URL(env().APP_URL).origin]);
  // Forwarded headers are client-controlled unless a trusted proxy overwrites them (TRUST_PROXY=true).
  const trustProxy = env().TRUST_PROXY;
  const host =
    (trustProxy ? req.headers.get("x-forwarded-host") : null) ?? req.headers.get("host");
  if (host) {
    const proto =
      (trustProxy ? req.headers.get("x-forwarded-proto") : null) ??
      new URL(req.url).protocol.replace(":", "");
    allowed.add(`${proto}://${host}`);
  }
  if (!allowed.has(origin))
    throw new HttpError(403, "csrf_origin_mismatch", "Cross-origin request rejected");
}

function refererOrigin(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * Client IP for rate limiting and audit. X-Forwarded-For / X-Real-IP are honoured only when TRUST_PROXY=true
 * (the proxy must overwrite them). Route handlers have no socket address, so without a trusted proxy this
 * returns null and callers fall back to a shared bucket.
 */
export function clientIp(req: Request): string | null {
  if (!env().TRUST_PROXY) return null;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip");
}
