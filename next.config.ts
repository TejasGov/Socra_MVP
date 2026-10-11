import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy without nonces (pages stay statically optimizable).
 * - Scripts: same origin plus inline (Next.js injects inline bootstrap/flight scripts). 'unsafe-eval' only in
 *   development, for React Refresh / dev overlays.
 * - Styles: same origin plus inline (Tailwind, CodeMirror and React `style` attributes).
 * - Fonts: same origin (next/font self-hosts). Images: same origin, data: and blob:.
 * - No plugins, no framing, no foreign form targets or <base> rewrites.
 * See docs/SECURITY.md (residual risk: 'unsafe-inline' scripts mean the CSP is not a defence against injected inline
 * script; it still blocks foreign script/style/connect origins and framing).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), " +
      "magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Packages that must stay as Node requires on the server (native bindings / dynamic requires).
  serverExternalPackages: [
    "pg",
    "@prisma/adapter-pg",
    "bullmq",
    "ioredis",
    "bcryptjs",
    "@vercel/sandbox",
  ],
  // The vercel-sandbox runner uploads the same bootstrap/harness files the Docker images bake in; it reads them
  // from disk at run time, so they must be traced into every server function bundle.
  outputFileTracingIncludes: {
    "/**": [
      "./docker/runner/bootstrap.py",
      "./docker/runner/harness.py",
      "./docker/runner/bootstrap.js",
      "./docker/runner/harness.js",
      // pg loads this socket adapter only inside workerd; Next's Node tracing cannot detect it.
      "./node_modules/pg-cloudflare/dist/**/*",
    ],
  },
  // Prisma's CLI and development database are build tools, never application dependencies.
  // Exclude their WASM assets so OpenNext does not package them as Worker modules.
  outputFileTracingExcludes: {
    "/**": ["./node_modules/prisma/**/*", "./node_modules/@prisma/dev/**/*"],
  },
  typedRoutes: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
