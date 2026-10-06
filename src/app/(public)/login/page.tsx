import { redirect } from "next/navigation";
import { DevBadge } from "@/components/ui";
import { getCurrentUser } from "@/server/auth/current-user";
import { safeNextPath } from "@/server/auth/oidc-provider";
import { homePathFor } from "@/server/auth/rbac";
import { env } from "@/server/env";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const ERROR_MESSAGES: Record<string, string> = {
  sso_not_provisioned:
    "Your university account is not enrolled in this pilot. Contact your instructor.",
  sso_inactive: "This account is deactivated.",
  sso_failed: "University sign-in failed. Try again.",
};

/** Seeded accounts (prisma/seed/users.ts). Listed only when NODE_ENV is development. */
const DEV_ACCOUNTS: Array<{ email: string; role: string }> = [
  { email: "student1@socra.local", role: "Student, CSE 115 and CSE 116" },
  { email: "student11@socra.local", role: "Student, CSE 115 and CSE 116" },
  { email: "student25@socra.local", role: "Student, CSE 116" },
  { email: "faculty@socra.local", role: "Instructor, both courses" },
  { email: "faculty2@socra.local", role: "Instructor, CSE 116" },
  { email: "ta@socra.local", role: "Teaching assistant" },
  { email: "research@socra.local", role: "Research admin" },
  { email: "admin@socra.local", role: "System admin" },
];

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(next ? safeNextPath(next) : homePathFor(user));
  const e = env();
  const isDev = e.NODE_ENV === "development";

  return (
    <main id="main" className="mx-auto w-full max-w-[380px] px-4 pt-20 pb-12">
      <p className="text-base font-semibold text-fg">Socra</p>
      <h1 className="mt-6 text-xl font-semibold text-fg">Sign in</h1>
      <p className="mt-1 text-sm text-fg-muted">CSE 115 and CSE 116 pilot, University at Buffalo.</p>

      {error && ERROR_MESSAGES[error] ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          {ERROR_MESSAGES[error]}
        </p>
      ) : null}

      <div className="mt-6">
        <LoginForm next={next} localEnabled={e.AUTH_LOCAL_ENABLED} oidcConfigured={e.OIDC_CONFIGURED} />
      </div>

      {isDev && e.AUTH_LOCAL_ENABLED ? (
        <details className="mt-8 border-t border-border pt-4 text-sm">
          <summary className="cursor-pointer text-fg-muted">Development accounts</summary>
          <p className="mt-2 text-xs text-fg-subtle">
            Seeded accounts. Every password is <code className="font-mono">socra-dev-password</code>.
            Students are student1 to student30.
          </p>
          <ul className="mt-2 space-y-1">
            {DEV_ACCOUNTS.map((a) => (
              <li key={a.email} className="flex justify-between gap-3 text-xs">
                <code className="font-mono text-fg">{a.email}</code>
                <span className="text-fg-subtle">{a.role}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {e.AI_MOCK_MODE ? (
        <div className="mt-6">
          <DevBadge />
        </div>
      ) : null}
    </main>
  );
}
