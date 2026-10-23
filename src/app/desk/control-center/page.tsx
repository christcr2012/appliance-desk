import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isCapability, type Capability } from "@/domains/capabilities";
import { OWNER_ACTION_GROUPS, searchOwnerActions, visibleOwnerActions } from "@/lib/owner-actions";
import { loadReadiness, READINESS_STATE_TEXT } from "@/domains/control-center/readiness";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import {
  addSavedView, describeSavedView, getWorkspace, pinAction, removeSavedView, savedViewHref, setOptionalCardHidden, unpinAction,
  usablePins, WorkspaceError, MAX_PINNED, MAX_SAVED_VIEWS, MAX_VIEW_LABEL, OPTIONAL_TODAY_CARDS, SAVED_VIEW_ROUTES, SAVED_VIEW_ROUTE_KEYS,
} from "@/domains/workspace";

export const metadata = { title: "Manage my business", robots: { index: false, follow: false } };

async function limitedFor(userId: string, role: string): Promise<Capability[]> {
  if (role !== "ADMIN") return [];
  const rows = await prisma.staffCapabilityOverride.findMany({ where: { userId, allowed: false }, take: 20 });
  return rows.map((r) => r.capability).filter(isCapability);
}

const PAGE = "/desk/control-center";

/** One shared wrapper: check who is asking, run the change, show a plain message if it is refused. */
async function run(form: FormData, change: (userId: string, version: number) => Promise<void>) {
  const session = await requireRole("OWNER", "ADMIN");
  const version = Number(form.get("version"));
  try {
    await change(session.user.id, version);
  } catch (e) {
    if (e instanceof WorkspaceError) redirect(`${PAGE}?error=${encodeURIComponent(e.message)}#my-workspace`);
    throw e;
  }
  revalidatePath(PAGE);
  revalidatePath("/desk/today");
  redirect(`${PAGE}#my-workspace`);
}
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

async function pin(form: FormData) { "use server"; await run(form, (u, v) => pinAction(u, v, text(form, "id"))); }
async function unpin(form: FormData) { "use server"; await run(form, (u, v) => unpinAction(u, v, text(form, "id"))); }
async function toggleNote(form: FormData) { "use server"; await run(form, (u, v) => setOptionalCardHidden(u, v, text(form, "id"), text(form, "hide") === "1")); }
async function removeView(form: FormData) { "use server"; await run(form, (u, v) => removeSavedView(u, v, text(form, "id"))); }
async function saveView(form: FormData) {
  "use server";
  const routeKey = text(form, "routeKey");
  const spec = Object.hasOwn(SAVED_VIEW_ROUTES, routeKey) ? SAVED_VIEW_ROUTES[routeKey as keyof typeof SAVED_VIEW_ROUTES] : null;
  const filters: Record<string, string> = {};
  if (spec) for (const key of Object.keys(spec.filters)) { const v = text(form, `f-${key}`); if (v) filters[key] = v; }
  await run(form, (u, v) => addSavedView(u, v, { label: text(form, "label"), routeKey, filters }));
}

export default async function ControlCenterPage({ searchParams }: { searchParams: Promise<{ q?: string; error?: string }> }) {
  const session = await requireRole("OWNER", "ADMIN");
  const role = session.user.role;
  const params = await searchParams;
  const q = (params.q ?? "").slice(0, 100).trim();
  const [limited, readiness, workspace] = await Promise.all([limitedFor(session.user.id, role), loadReadiness(role), getWorkspace(session.user.id)]);
  const actions = visibleOwnerActions(role, limited);
  const { prefs, version } = workspace;
  const pins = usablePins(prefs, actions);
  const pinned = new Set(prefs.pinnedActionIds);
  const found = q ? searchOwnerActions(actions, q) : null;
  const checkedAt = readiness[0]?.checkedAt;
  return (
    <main className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-xl font-semibold">Manage my business</h1>
      <p className="text-sm text-ink-soft">
        Everything you can do, grouped by what you are trying to get done. This page only shows and links; each screen asks
        for your sign-in and checks what you are allowed to do before anything changes.
      </p>
      {params.error && <p role="alert" className="rounded-md border border-red-600 p-3 text-sm">{params.error}</p>}
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
                <PinButton id={a.id} label={a.label} pinned={pinned.has(a.id)} version={version} />
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
                  <PinButton id={a.id} label={a.label} pinned={pinned.has(a.id)} version={version} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section id="my-workspace" aria-labelledby="ws" className="space-y-4 scroll-mt-4">
        <h2 id="ws" className="font-medium">My workspace</h2>
        <p className="text-sm text-ink-soft">
          Only you see this. Pin up to {MAX_PINNED} shortcuts and save up to {MAX_SAVED_VIEWS} filtered views; they show at the top of Today.
          Nothing here changes what you are allowed to do.
        </p>
        <div className="rounded-md border p-3">
          <h3 className="font-medium">Pinned shortcuts</h3>
          {pins.length === 0 ? <p className="text-sm text-ink-soft">None yet. Use the Pin button on any card above.</p> : (
            <ul className="space-y-1">
              {pins.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={a.href} className="underline">{a.label}</Link>
                  <form action={unpin}><input type="hidden" name="version" value={version} /><input type="hidden" name="id" value={a.id} />
                    <button type="submit" aria-label={`Unpin ${a.label}`} className="min-h-11 rounded-md border px-3">Unpin</button></form>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-md border p-3">
          <h3 className="font-medium">Optional notes on Today</h3>
          <p className="text-sm text-ink-soft">These are gentle nudges. You can hide them. Anything important (money, deadlines, safety) always shows and has no switch.</p>
          <ul className="space-y-1">
            {OPTIONAL_TODAY_CARDS.map((c) => {
              const hidden = prefs.hiddenOptionalCardIds.includes(c.id);
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{c.label}: {hidden ? "hidden" : "shown"}</span>
                  <form action={toggleNote}><input type="hidden" name="version" value={version} /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="hide" value={hidden ? "0" : "1"} />
                    <button type="submit" className="min-h-11 rounded-md border px-3">{hidden ? "Show again" : "Hide"}</button></form>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="rounded-md border p-3">
          <h3 className="font-medium">Saved views</h3>
          {prefs.savedViews.length === 0 ? <p className="text-sm text-ink-soft">None yet. Pick a screen below, choose a filter and give it a name.</p> : (
            <ul className="space-y-1">
              {prefs.savedViews.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={savedViewHref(v)} className="underline">{v.label}</Link><span className="text-ink-soft">{describeSavedView(v)}</span>
                  <form action={removeView}><input type="hidden" name="version" value={version} /><input type="hidden" name="id" value={v.id} />
                    <button type="submit" aria-label={`Remove view ${v.label}`} className="min-h-11 rounded-md border px-3">Remove</button></form>
                </li>
              ))}
            </ul>
          )}
          {SAVED_VIEW_ROUTE_KEYS.map((key) => {
            const route = SAVED_VIEW_ROUTES[key];
            return (
              <form key={key} action={saveView} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="version" value={version} />
                <input type="hidden" name="routeKey" value={key} />
                <div>
                  <label htmlFor={`label-${key}`} className="block text-sm font-medium">{route.label}: view name</label>
                  <input id={`label-${key}`} name="label" required maxLength={MAX_VIEW_LABEL} className="w-48 rounded-md border bg-surface p-2" />
                </div>
                {(Object.entries(route.filters) as Array<[string, { label: string; options: ReadonlyArray<{ value: string; label: string }> }]>).map(([fk, f]) => (
                  <div key={fk}>
                    <label htmlFor={`f-${key}-${fk}`} className="block text-sm font-medium">{f.label}</label>
                    <select id={`f-${key}-${fk}`} name={`f-${fk}`} defaultValue="" className="rounded-md border bg-surface p-2">
                      <option value="">Any</option>
                      {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                ))}
                <button type="submit" className="min-h-11 rounded-md border px-4 py-2 font-medium">Save view</button>
              </form>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function PinButton({ id, label, pinned, version }: { id: string; label: string; pinned: boolean; version: number }) {
  return (
    <form action={pinned ? unpin : pin} className="mt-1">
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="id" value={id} />
      <button type="submit" aria-label={`${pinned ? "Unpin" : "Pin"} ${label}`} className="min-h-11 rounded-md border px-3 text-sm">{pinned ? "Unpin" : "Pin to Today"}</button>
    </form>
  );
}
