import Link from "next/link";

export const metadata = { title: "Not allowed" };

export default function ForbiddenPage() {
  return (
    <main id="main" className="mx-auto mt-24 max-w-md px-4">
      <h1 className="text-xl font-semibold">You do not have access to this page</h1>
      <p className="mt-2 text-fg-muted">
        Your account does not have the role required for this area.
      </p>
      <p className="mt-4">
        <Link href="/" className="underline">
          Go to your home page
        </Link>
      </p>
    </main>
  );
}
