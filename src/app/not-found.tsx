import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto mt-24 max-w-md px-4">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-4">
        <Link href="/" className="underline">
          Go to your home page
        </Link>
      </p>
    </main>
  );
}
