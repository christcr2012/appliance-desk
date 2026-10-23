import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-ink">
      <div className="rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">We couldn&apos;t find that page</h1>
        <p className="mt-3 text-base leading-7 text-ink-soft">
          The link may be old or mistyped. Start from the home page and you should find what you
          need.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-action px-5 font-medium text-on-action"
        >
          Go to the home page
        </Link>
      </div>
    </main>
  );
}
