import Link from "next/link";
import { requireRole } from "@/lib/session";
import { hasVaultCryptoKey } from "@/lib/field-crypto";
import { listCredentials } from "@/domains/vault";
import { getVaultUnlockStatus } from "@/domains/vault/unlock";
import { getEmergencyOwnerView } from "@/domains/vault/emergency";
import { getSecondStepView } from "@/domains/security/second-step";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { createCredentialAction } from "./actions";
import { CredentialForm } from "./credential-form";
import { EmergencyPanel } from "./emergency-panel";
import { UnlockForm } from "./unlock-form";

export const metadata = { title: "Logins vault" };
export const dynamic = "force-dynamic";

function denverDateTime(date: Date): string {
  return date.toLocaleString("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function VaultPage() {
  const session = await requireRole("OWNER");
  const keyReady = hasVaultCryptoKey();
  const [unlock, credentials, emergency, secondStep] = await Promise.all([
    getVaultUnlockStatus(session.user.id, session.session.id),
    listCredentials(session.user.id),
    getEmergencyOwnerView(session.user.id),
    getSecondStepView(session.user.id).catch(() => null),
  ]);
  const defaultMethod = secondStep?.method === "TOTP" || !secondStep?.method ? "totp" : "otp";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Logins vault"
        description="The logins the business runs on — Revenue Online, the bank, Stripe, your domain — kept encrypted, visible only to you, and only after a fresh sign-in code."
      />
      <p className="rounded-control border border-line bg-subtle p-3 text-sm">
        Stored encrypted. For the most sensitive logins (your bank), a password manager is safer; you can keep
        just a note here.
      </p>

      {!keyReady && (
        <Card title="Not set up yet">
          <p className="text-sm text-ink-soft">
            The vault encryption key isn&apos;t on the server yet, so no login can be saved safely. Add it under
            Owner checklist → &ldquo;Vault encryption key&rdquo; (the Set up your business walkthrough for
            encryption keys walks through it), and this page turns on by itself.
          </p>
        </Card>
      )}

      {keyReady && (
        <Card
          title={unlock.unlocked ? "Unlocked" : unlock.locked ? "Vault locked" : "Unlock the vault"}
          description={
            unlock.unlocked
              ? `This session can show and save secrets until ${unlock.expiresAt ? denverDateTime(unlock.expiresAt) : "soon"}. It locks again on its own.`
              : unlock.locked
                ? `Too many wrong codes. The vault unlocks again at ${unlock.lockedUntil ? denverDateTime(unlock.lockedUntil) : "later"} — we've emailed you about the lock.`
                : secondStep && !secondStep.enrolled
                  ? "Set up two-step sign-in first (My account), then you'll unlock the vault with the same code you'd use to sign in."
                  : "Showing a saved username, password or note — and saving a new or changed one — needs a fresh code, the same second step you use to sign in. The unlock lasts 5 minutes, on this device only."
          }
        >
          {!unlock.unlocked && !unlock.locked && secondStep?.enrolled && (
            <UnlockForm defaultMethod={defaultMethod} />
          )}
          {!unlock.unlocked && !unlock.locked && secondStep && !secondStep.enrolled && (
            <ButtonLink href="/desk/account" variant="secondary">
              Go to My account
            </ButtonLink>
          )}
        </Card>
      )}

      <Card title="Your logins" description="Names and masked usernames only — tap a login to show or copy its details.">
        {credentials.length === 0 ? (
          <EmptyState title="No logins saved yet" description="Add the first one below — the portals and accounts from your business records are good candidates." />
        ) : (
          <ul className="divide-y divide-line">
            {credentials.map((c) => (
              <li key={c.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/desk/vault/${c.id}`} className="font-semibold text-action underline">
                    {c.title}
                  </Link>
                  {c.rotation?.overdue && (
                    <span className="rounded bg-accent px-1.5 py-0.5 text-xs font-semibold">Password change due</span>
                  )}
                </div>
                <p className="text-sm text-ink-soft">
                  {c.url ?? "No website saved"}
                  {c.usernameMasked ? ` · ${c.usernameMasked}` : ""}
                  {c.rotateEveryMonths ? ` · change every ${c.rotateEveryMonths} months` : ""}
                </p>
                {c.linkedRecords.length > 0 && (
                  <p className="text-sm text-ink-soft">
                    Linked: {c.linkedRecords.map((r) => r.title).join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {keyReady && (
        <Card title="Add a login">
          <CredentialForm action={createCredentialAction} submitLabel="Save login" unlocked={unlock.unlocked} />
        </Card>
      )}

      <Card
        title="Emergency access"
        description="One person you trust, a waiting period you control, and a single read-only export — only if something happens to you."
      >
        <EmergencyPanel view={emergency} />
      </Card>
    </div>
  );
}
