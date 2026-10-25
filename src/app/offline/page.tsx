import Image from "next/image";
import { TryAgain } from "./try-again";

// Public and content-free: safe for a shared service-worker cache.
export const metadata = { title: "Offline · Appliance Desk", robots: { index: false, follow: false } };

export default function OfflinePage() {
  return (
    <main id="main-content" className="mx-auto flex min-h-[80vh] max-w-md flex-col items-center justify-center gap-5 px-5 text-center">
      <Image src="/brand/badge.svg" alt="" width={64} height={64} />
      <h1 className="text-[28px] font-extrabold text-ink">You're offline</h1>
      <p className="text-ink-soft">You're offline. Your changes are paused until the connection is back.</p>
      <TryAgain />
    </main>
  );
}
