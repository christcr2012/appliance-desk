import Link from "next/link";

// This is a placeholder homepage. The real public site (rentals info,
// pricing, property-managers page, lead form, etc.) is built in Phase 2 —
// see docs/ROADMAP.md. This page exists in Phase 1 only to prove the app
// deploys and renders.
export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-semibold">[Company Name]</h1>
      <p className="text-gray-600">
        Appliance rentals in Colorado. This site is under construction.
      </p>
      <p>
        <Link href="/login" className="text-blue-700 underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
