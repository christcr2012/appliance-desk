import Link from "next/link";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isCapability, type Capability } from "@/domains/capabilities";
import { OWNER_ACTION_GROUPS, searchOwnerActions, visibleOwnerActions } from "@/lib/owner-actions";
import { loadReadiness, READINESS_STATE_TEXT } from "@/domains/control-center/readiness";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";

export const metadata = { title: "Manage my business", robots: { index: false, follow: false } };

async function limitedFor(userId: string, role: string): Promise<Capability[]> {
  if (role !== "ADMIN") return [];
  const rows = await prisma.staffCapabilityOverride.findMany({ where: { userId, allowed: false }, take: 20 });
  return rows.map((r) => r.capability).filter(isCapability);
}

export default async function ControlCenterPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await requireRole("OWNER", "ADMIN");
  const role = session.user.role;
  const q = ((await searchParams).q ?? "").slice(0, 100).trim();
  const [limited, readiness] = await Promise.all([limitedFor(session.user.id, role), loadReadiness(role)]);
  const actions = visibleOwnerActions(role, limited);
  const found = q ? searchOwnerActions(actions, q) : null;
  const checkedAt = readiness[0]?.checkedAt;
  return (
    <main className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-xl font-semibold">Manage my business</h1>
      <p className="text-sm text-ink-soft">
        Everything you can do, grouped by what you are trying to get done. This page only shows and links; each screen asks
        for your sign-in and checks what you are allowed to do before anything changes.
      </p>
      <form method="get" role="search" className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="q" className="block text-sm font-medium">What do you want to do?</label>
          <input id="q" name="q" defaultValue={q} maxLength={100} placeholder="for example: change rent, fix failed payment, stop reminders" className="w-80 max-w-full rounded-md border bg-surface p-2" />
        </div>
        <button type="submit" className="min-h-11 rounded-md border px-4 py-2 font-medium">Find it</button>
        {q && <Link href="/desk/control-center" className="min-h-11 py-2 text-sm underline">Clear</Link>}
      </form>

      {found && (
        <section aria-labelledby="results" className="space-y-3">
          <h2 id="results" className="font-medium">{found.length === 0 ? `Nothing matched “${q}”` : `Best matches for “${q}”`}</h2>
          {found.length === 0 && <p className="text-sm text-ink-soft">Try fewer or simpler words, or look through the groups below.</p>}
          <ul className="space-y-2">
            {found.map((a) => (
              <li key={a.id} className="rounded-md border p-3">
                <Link href={a.href} className="font-medium underline">{a.label}</Link>
                <p className="text-sm">{a.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="status" className="space-y-3">
        <h2 id="status" className="font-medium">Right now</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {readiness.map((c) => (
            <li key={c.id} className="rounded-md border p-3">
              <p className="font-medium">{c.label}: <span>{READINESS_STATE_TEXT[c.state]}</span></p>
              <p className="text-sm">{c.detail}</p>
              <Link href={c.href} className="text-sm underline">Open</Link>
            </li>
          ))}
        </ul>
        {checkedAt && <p className="text-xs text-ink-soft">Checked {formatBusinessDate(checkedAt)} at {formatBusinessTime(checkedAt)}. Anything that could not be checked says so; it is never shown as fine.</p>}
      </section>

      {OWNER_ACTION_GROUPS.map((g) => {
        const items = actions.filter((a) => a.group === g.id);
        if (items.length === 0) return null;
        return (
          <section key={g.id} aria-labelledby={`g-${g.id}`} className="space-y-2">
            <h2 id={`g-${g.id}`} className="font-medium">{g.label}</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {items.map((a) => (
                <li key={a.id} className="rounded-md border p-3">
                  <Link href={a.href} className="font-medium underline">{a.label}</Link>
                  <p className="text-sm text-ink-soft">{a.summary}</p>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
