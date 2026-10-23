import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { CAPABILITIES, CAPABILITY_KEYS, CapabilityError, listAdminCapabilities, setAdminCapability } from "@/domains/capabilities";

export const metadata = { title: "What each admin may do", robots: { index: false, follow: false } };

async function change(form: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const allowed = form.get("allowed") === "yes";
  try {
    await setAdminCapability(session.user.id, String(form.get("adminId") ?? ""), String(form.get("capability") ?? ""), allowed);
  } catch (e) {
    if (!(e instanceof CapabilityError)) throw e;
  }
  revalidatePath("/desk/settings/permissions");
}

export default async function PermissionsPage() {
  await requireRole("OWNER");
  const admins = await listAdminCapabilities();
  return (
    <main className="mx-auto max-w-3xl space-y-5">
      <Link href="/desk/settings?section=staff" className="text-sm underline">Back to staff</Link>
      <h1 className="text-xl font-semibold">What each admin may do</h1>
      <p className="text-sm text-ink-soft">
        Right now every admin can do everything listed here, and you can take any one away from a single admin. You always
        keep every permission. Staff accounts can do none of these, and this page does not change that. A change takes effect
        on that admin&apos;s very next action, and every change is saved in the settings activity.
      </p>
      {admins.length === 0 && <p className="rounded-md border p-4 text-sm">You have no admin accounts. Add one under Staff and it will appear here.</p>}
      {admins.map((a) => (
        <section key={a.userId} className="rounded-md border p-4" aria-labelledby={`admin-${a.userId}`}>
          <h2 id={`admin-${a.userId}`} className="font-semibold">{a.name}</h2>
          <p className="text-xs text-ink-soft">{a.email}</p>
          <ul className="mt-3 space-y-3">
            {CAPABILITY_KEYS.map((k) => {
              const on = !a.limited.includes(k);
              return (
                <li key={k} className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{CAPABILITIES[k].label}</p>
                    <p className="text-xs text-ink-soft">{CAPABILITIES[k].help} Currently {on ? "allowed" : "not allowed"}.</p>
                  </div>
                  <form action={change}>
                    <input type="hidden" name="adminId" value={a.userId} />
                    <input type="hidden" name="capability" value={k} />
                    <input type="hidden" name="allowed" value={on ? "no" : "yes"} />
                    <button type="submit" className="min-h-11 rounded-md border px-4 py-2">{on ? "Take this away" : "Give it back"}</button>
                  </form>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </main>
  );
}
