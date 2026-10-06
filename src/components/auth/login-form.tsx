"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface LoginFormProps {
  next?: string;
  localEnabled: boolean;
  oidcConfigured: boolean;
}

export function LoginForm({ next, localEnabled, oidcConfigured }: LoginFormProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password"), next }),
      });
      const body = (await res.json().catch(() => null)) as {
        redirectTo?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(body?.error?.message ?? "Sign in failed");
        return;
      }
      router.replace(body?.redirectTo ?? "/");
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  const ssoHref = `/api/auth/oidc/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="space-y-6">
      {localEnabled ? (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="block text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded bg-gray-900 px-3 py-2 font-medium text-white disabled:opacity-60"
          >
            {pending ? "Signing in" : "Sign in"}
          </button>
        </form>
      ) : null}
      <div>
        {oidcConfigured ? (
          <a
            href={ssoHref}
            className="block w-full rounded border border-gray-300 px-3 py-2 text-center font-medium"
          >
            Sign in with university SSO
          </a>
        ) : (
          <p className="text-sm text-gray-600">
            University SSO is not configured in this environment.
          </p>
        )}
      </div>
    </div>
  );
}
