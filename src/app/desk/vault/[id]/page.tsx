import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getCredential, listRecordsForLinking } from "@/domains/vault";
import { getVaultUnlockStatus } from "@/domains/vault/unlock";
import { getSecondStepView } from "@/domains/security/second-step";
import { Button, ButtonLink, Card, PageHeader } from "@/components/ui";
import {
  deleteCredentialAction,
  markRotatedAction,
  unlinkRecordAction,
  updateCredentialAction,
} from "../actions";
import { CredentialForm } from "../credential-form";
import { LinkRecordForm } from "../link-record-form";
import { RevealField } from "../reveal-field";
import { UnlockForm } from "../unlock-form";

export const metadata = { title: "Login" };
export const dynamic = "force-dynamic";

export default async function VaultCredentialPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRole("OWNER");
  const { id } = await params;
  const credential = await getCredential(session.user.id, id).catch(() => null);
  if (!credential) notFound();

  const [unlock, records, secondStep] = await Promise.all([
    getVaultUnlockStatus(session.user.id, session.session.id),
    listRecordsForLinking(session.user.id),
    getSecondStepView(session.user.id).catch(() => null),
  ]);
  const defaultMethod = secondStep?.method === "TOTP" || !secondStep?.method ? "totp" : "otp";
  const linkable = records.filter((r) => r.linkedCredentialId !== id);

  return (
    <div className="space-y-6">
      <PageHeader
        title={credential.title}
        description="Owner only. Values stay encrypted until you unlock the vault and tap Show or Copy — every look is written to the activity log, without the value."
        secondaryActions={
          <Link href="/desk/vault" className="text-sm font-semibold text-action underline">
            Back to all logins
          </Link>
        }
      />

      {!unlock.unlocked && (
        <Card
          title={unlock.locked ? "Vault locked" : "Unlock to see the values"}
          description={
            unlock.locked
              ? "Too many wrong codes — the vault unlocks again in a little while, and we've emailed you about the lock."
              : secondStep && !secondStep.enrolled
                ? "Set up two-step sign-in first (My account), then you'll unlock the vault with the same code you'd use to sign in."
                : "Enter a fresh sign-in code to show, copy or change the saved values. The unlock lasts 5 minutes, on this device only."
          }
        >
          {!unlock.locked && secondStep?.enrolled && <UnlockForm defaultMethod={defaultMethod} />}
          {!unlock.locked && secondStep && !secondStep.enrolled && (
            <ButtonLink href="/desk/account" variant="secondary">
              Go to My account
            </ButtonLink>
          )}
        </Card>
      )}

      <Card title="Saved values">
        <dl className="grid gap-5 sm:grid-cols-2">
          <RevealField credentialId={id} field="username" label="Username" hasValue={credential.hasUsername} />
          <RevealField credentialId={id} field="password" label="Password" hasValue={credential.hasPassword} />
          <RevealField credentialId={id} field="notes" label="Notes" hasValue={credential.hasNotes} />
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Second step</dt>
            <dd className="mt-1 text-sm">{credential.totpHint ?? "Not noted"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Website</dt>
            <dd className="mt-1 text-sm">
              {credential.url ? (
                <a href={credential.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-action underline">
                  {credential.url}
                </a>
              ) : (
                "Not saved"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Password last changed</dt>
            <dd className="mt-1 text-sm">
              {credential.lastRotatedOn ?? "Not recorded"}
              {credential.rotation?.overdue && (
                <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-xs font-semibold">Change due</span>
              )}
            </dd>
          </div>
        </dl>
        {credential.hasPassword && (
          <form action={markRotatedAction.bind(null, id)} className="mt-4">
            <Button type="submit" variant="secondary">
              I changed this password today
            </Button>
          </form>
        )}
      </Card>

      <Card title="Linked business records" description="Linking a record shows “Login: this one” on the record's page, so the number and the login stay one tap apart.">
        {credential.linkedRecords.length === 0 ? (
          <p className="text-sm text-ink-soft">Not linked to any record yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {credential.linkedRecords.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <Link href={`/desk/paperwork/${r.id}`} className="font-semibold text-action underline">
                  {r.title}
                </Link>
                <form action={unlinkRecordAction.bind(null, r.id)}>
                  <Button type="submit" variant="secondary">
                    Unlink
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {linkable.length > 0 && <LinkRecordForm credentialId={id} records={linkable} />}
      </Card>

      <Card title="Details">
        <CredentialForm
          action={updateCredentialAction.bind(null, id, credential.version)}
          submitLabel="Save changes"
          unlocked={unlock.unlocked}
          initialValues={{
            title: credential.title,
            url: credential.url ?? "",
            totpHint: credential.totpHint ?? "",
            rotateEveryMonths: credential.rotateEveryMonths ? String(credential.rotateEveryMonths) : "",
            hasUsername: credential.hasUsername,
            hasPassword: credential.hasPassword,
            hasNotes: credential.hasNotes,
          }}
        />
      </Card>

      <Card title="Remove this login">
        <p className="mb-3 text-sm text-ink-soft">
          Removing deletes the saved username, password and notes for good. Records linked to it stay — they just
          lose the login link.
        </p>
        <form action={deleteCredentialAction.bind(null, id)}>
          <Button type="submit" variant="danger">
            Remove this login
          </Button>
        </form>
      </Card>
    </div>
  );
}
