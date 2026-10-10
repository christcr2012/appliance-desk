import Link from "next/link";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { communicationsPolicySchema } from "@/domains/messaging/communications-policy";
import { RECOMMENDED_TELECOM_ALERT_RULES } from "@/domains/messaging/telecom-alerts";
import { TelecomSettingsControls } from "../telecom-controls";

export const dynamic = "force-dynamic";

/** Private company configuration; no provider credential or media URL is exposed. */
export default async function TelecomSettingsPage() {
  const session = await requireRole("OWNER","ADMIN");
  const [accounts,settings,statements,templates] = await Promise.all([
    prisma.telecomAccount.findMany({
      take:25,orderBy:[{createdAt:"asc"},{id:"asc"}],
      select:{id:true,label:true,environment:true,status:true,checkedAt:true,readiness:true,
        numbers:{take:10,orderBy:{createdAt:"asc"},
          select:{id:true,address:true,isPrimary:true,registrationStatus:true,
            verifiedAt:true,retiredAt:true,capabilities:true}}},
    }),
    prisma.businessSettings.findUnique({where:{id:"singleton"},
      select:{communicationsPolicy:true,communicationsPolicyVersion:true,customerSmsEnabled:true}}),
    prisma.telecomStatement.findMany({take:30,orderBy:{createdAt:"desc"},select:{
      id:true,accountId:true,externalId:true,revision:true,state:true,
      invoiceTotalCents:true,currency:true,periodStart:true,periodEnd:true,evidenceHash:true,
    }}),
    prisma.communicationTemplateRevision.findMany({
      where:{channel:"SMS",isCurrent:true},take:25,orderBy:{createdAt:"desc"},
      select:{id:true,key:true,revision:true,approvedAt:true},
    }),
  ]);
  const policy = communicationsPolicySchema.safeParse(settings?.communicationsPolicy);
  const canEdit=session.user.role==="OWNER";
  const configured=policy.success;
  const accountLabels=new Map(accounts.map(a=>[a.id,a.label]));
  return <div className="mx-auto max-w-5xl space-y-6 pb-12">
    <nav className="text-sm"><Link href="/desk/settings?section=notifications" className="underline">
      Back to notification settings
    </Link></nav>
    <header>
      <h1 className="text-2xl font-bold">Phone, texts and provider costs</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Review setup and private billing evidence. Saving suggested warnings does not turn on SMS,
        phone calls, voicemail or provider billing. Provider activation and policy approvals are separate.
      </p>
    </header>
    <section aria-labelledby="account-list" className="rounded-card border border-line p-4">
      <h2 id="account-list" className="text-lg font-semibold">Provider accounts and owned numbers</h2>
      <p className="mt-1 text-sm text-ink-soft">Recorded setup and read-only provider observations
        are shown separately. A number capability is not permission to contact customers.</p>
      {accounts.length===0 && <p className="mt-3 text-sm">No provider account is recorded.
        Connect an approved account as part of the separate launch setup.</p>}
      <ul className="mt-3 space-y-4">
        {accounts.map(a=><li key={a.id} className="rounded border border-line p-3">
          <h3 className="font-semibold">{a.label}</h3>
          <p className="mt-1 text-sm">Environment: {a.environment} · Recorded status: {a.status}</p>
          <p className="text-sm">Provider checked: {a.checkedAt
            ? a.checkedAt.toLocaleString("en-US",{timeZone:"America/Denver"})
            : "not yet checked"} (Denver time)</p>
          <p className="mt-2 text-sm">Read-only provider status: {observedProviderStatus(a.readiness)}.
            {" "}SMS capability: {observedCapability(a.readiness,"observedSmsCapability")};
            {" "}voice capability: {observedCapability(a.readiness,"observedVoiceCapability")};
            {" "}primary number matched: {observedCapability(a.readiness,"primaryNumberConfirmed")}.
            {" "}A2P approval: separately required, not established by this observation.</p>
          <ul className="mt-2 space-y-1 text-sm">
            {a.numbers.map(n=><li key={n.id}>Number {n.address}:
              {" "}{n.registrationStatus}; {n.retiredAt?"retired":n.verifiedAt?"verified record":"unverified record"};
              {n.isPrimary?" primary number":""}; observed SMS: {observedCapability(n.capabilities,"sms")}; voice: {observedCapability(n.capabilities,"voice")}
            </li>)}
            {a.numbers.length===0 && <li>No owned numbers recorded.</li>}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">
            Registration/A2P, consent, disclosures, sending and voice switches must be approved separately.
          </p>
        </li>)}
      </ul>
    </section>
    <section className="rounded-card border border-line p-4" aria-labelledby="template-list">
      <h2 id="template-list" className="font-semibold">SMS template approvals</h2>
      <p className="mt-1 text-sm text-ink-soft">These are stored templates, not sent messages.
        Editing their wording or approving customer use is a separate owner action.</p>
      <ul className="mt-3 space-y-2 text-sm">
        {templates.map(t=><li key={t.id}>{t.key} — revision {t.revision},
          {" "}{t.approvedAt?"approved for the recorded policy":"not approved"}</li>)}
        {templates.length===0 && <li>No current SMS templates recorded.</li>}
      </ul>
      <p className="mt-3 text-sm"><Link className="underline"
        href="/desk/settings?section=notifications">View existing message template previews</Link></p>
    </section>
    <p className="text-sm text-ink-soft">
      Customer SMS master switch: <strong>{settings?.customerSmsEnabled?"on (still subject to all other approvals)":"off"}</strong>.
      {" "}Communications policy: <strong>{configured?"saved":"not initialized"}</strong>.
      {canEdit?" Owner access to edit proposals is available.":" Only the Owner can make changes."}
    </p>
    <TelecomSettingsControls
      accounts={accounts.map(a=>({id:a.id,label:a.label}))}
      statements={statements.map(row=>({
        id:row.id,accountLabel:accountLabels.get(row.accountId)??"Unknown account",
        externalId:row.externalId,revision:row.revision,state:row.state,
        cents:row.invoiceTotalCents,currency:row.currency,
        period:row.periodStart.toISOString().slice(0,10)+" to "+row.periodEnd.toISOString().slice(0,10),
        hash:row.evidenceHash,
      }))}
      canEdit={canEdit} canSavePolicy={configured || accounts.some(a=>a.numbers.some(n=>n.isPrimary && !n.retiredAt))}
      bootstrapAccountId={accounts.find(a=>a.numbers.some(n=>n.isPrimary && !n.retiredAt))?.id??null}
      version={settings?.communicationsPolicyVersion??0}
      savedRules={configured ? (policy.data.telecomCostAlerts??RECOMMENDED_TELECOM_ALERT_RULES)
        : RECOMMENDED_TELECOM_ALERT_RULES}
    />
  </div>;
}
function observedCapability(value: unknown, key: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unknown";
  const state = (value as Record<string,unknown>)[key];
  return typeof state === "boolean" ? (state ? "yes" : "no") : "unknown";
}
function observedProviderStatus(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unknown";
  const state = (value as Record<string,unknown>).providerAccountStatus;
  return typeof state === "string" && ["active","suspended","closed"].includes(state)
    ? state : "unknown";
}
