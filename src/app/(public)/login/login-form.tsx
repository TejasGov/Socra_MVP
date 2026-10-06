"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, Input, buttonClasses } from "@/components/ui";

export function LoginForm({
  next,
  localEnabled,
  oidcConfigured,
}: {
  next?: string;
  localEnabled: boolean;
  oidcConfigured: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, next }),
      });
      const body = (await res.json().catch(() => null)) as {
        redirectTo?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(body?.error?.message ?? "Sign in failed. Try again.");
        setPending(false);
        return;
      }
      router.replace(body?.redirectTo ?? "/");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setPending(false);
    }
  }

  const ssoHref = `/api/auth/oidc/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="space-y-5">
      {oidcConfigured ? (
        <a href={ssoHref} className={buttonClasses(localEnabled ? "secondary" : "primary", "lg", "w-full")}>
          Sign in with university SSO
        </a>
      ) : null}
      {oidcConfigured && localEnabled ? (
        <p className="text-xs text-fg-subtle">Or sign in with a pilot account password.</p>
      ) : null}
      {localEnabled ? (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field id="email" label="Email">
            <Input
              name="email"
              type="email"
              autoComplete="username"
              required
              data-testid="login-email"
            />
          </Field>
          <Field id="password" label="Password">
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              data-testid="login-password"
            />
          </Field>
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={pending}
            loadingLabel="Signing in…"
            className="w-full"
            data-testid="login-submit"
          >
            Sign in
          </Button>
        </form>
      ) : null}
      {!localEnabled && !oidcConfigured ? (
        <p role="alert" className="text-sm text-danger">
          No sign-in method is configured for this environment. Contact the pilot administrator.
        </p>
      ) : null}
    </div>
  );
}
