import Image from "next/image";

// Public and content-free: safe to cache. Recovery is a plain link so no offline JavaScript is required.
export const metadata = { title: "Offline · Appliance Desk", robots: { index: false, follow: false } };

export default function OfflinePage() {
  return (
    <main id="main-content" className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center gap-5 px-5 text-center">
      <Image src="/brand/badge.svg" alt="" width={64} height={64} />
      <h1 className="text-[28px] font-extrabold text-ink">You&apos;re offline</h1>
      <p className="text-ink-soft">You&apos;re offline. Your changes are paused until the connection is back.</p>
      <a href="/desk/today" className="inline-flex min-h-11 items-center rounded-field bg-primary px-5 py-3 font-bold text-on-primary focus-visible:outline-2 focus-visible:outline-offset-2">
        Try again
      </a>
    </main>
  );
}
