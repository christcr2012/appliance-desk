import Link from "next/link";

import { computeTaxBenefits, type BenefitRow } from "@/domains/taxben/benefits";
import {
  businessUsePercentFor,
  deMinimisElectionFor,
  personalShareAccounts,
} from "@/domains/taxben/classification";
import { getPolicyState, previewCapitalizationPolicy } from "@/domains/taxben/policy";
import {
  bonusClassOptions,
  bonusElectOutClasses,
  buildElectionStatements,
  returnDueKey,
} from "@/domains/taxben/elections";
import { businessDateKey } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { TaxActionForm } from "../setup/forms";
import { saveElectionsAction, saveWriteOffSettingsAction, signPolicyAction } from "./actions";

type Query = { year?: string };

function RowSection({ row }: { row: BenefitRow }) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">{row.title}</h3>
        <p className="text-lg font-semibold text-foreground">
          {row.amountCents !== null ? formatMoney(row.amountCents) : "—"}
        </p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{row.whatItIs}</p>
      {row.amountNote && <p className="mt-2 text-sm">{row.amountNote}</p>}
      <p className="mt-2 text-sm">{row.condition}</p>
      {row.details.length > 0 && (
        <div className="mt-3 overflow-x-auto" role="region" aria-label={`${row.title} details`} tabIndex={0}>
          <table className="w-full text-sm">
            <tbody>
              {row.details.map((detail) => (
                <tr key={detail.label} className="border-t border-border">
                  <td className="py-1.5 pr-4">{detail.label}</td>
                  <td className="py-1.5 text-right font-medium">{formatMoney(detail.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {row.deadline && <p className="mt-2 text-sm font-medium">Deadline: {row.deadline}</p>}
      <p className="mt-2 text-xs text-muted-foreground">{row.confirm}</p>
    </section>
  );
}

export default async function TaxBenefitsPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  const owner = session.user.role === "OWNER";
  const canUseSettings = session.user.role !== "ACCOUNTANT";
  const query = await searchParams;
  const currentYear = Number(businessDateKey(new Date()).slice(0, 4));
  const parsed = Number(query.year);
  const year = Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2100 ? parsed : currentYear;

  const [benefits, policy, policyPreview, settings, profileRow, classOptions, electOutChosen] =
    await Promise.all([
      computeTaxBenefits(year),
      getPolicyState(prisma, year),
      previewCapitalizationPolicy(prisma, year),
      prisma.businessSettings.findUnique({ where: { id: "singleton" } }),
      prisma.complianceProfile.findUnique({
        where: { id: "singleton" },
        select: { entityType: true },
      }),
      bonusClassOptions(prisma, year),
      bonusElectOutClasses(prisma, year),
    ]);
  const electionStatements = await buildElectionStatements(
    prisma,
    year,
    returnDueKey(profileRow?.entityType, year),
  );
  const shareAccounts = personalShareAccounts();
  const electionOn = deMinimisElectionFor(settings?.deMinimisElections ?? null, year);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold">Tax benefits {year}</h2>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Every write-off and benefit the app can find in your books, your
          fleet and your business facts — worked out fresh each time you open
          this page. These are estimates: your CPA confirms every one.
        </p>
        <p className="mt-2 text-sm">
          Tentative profit for {year}:{" "}
          <span className="font-semibold">{formatMoney(benefits.netProfitCents)}</span>
        </p>
        <p className="mt-2 flex gap-3 text-sm">
          <Link className="underline" href={`/desk/sales-tax/benefits?year=${year - 1}`}>
            ← {year - 1}
          </Link>
          {year < currentYear && (
            <Link className="underline" href={`/desk/sales-tax/benefits?year=${year + 1}`}>
              {year + 1} →
            </Link>
          )}
        </p>
      </div>

      {policy.status === "SIGNED" ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-base font-semibold text-foreground">
            Capitalization policy — signed
          </h3>
          <p className="mt-1 text-sm">
            The {year} policy was signed on {policy.signedOn} and is stored in{" "}
            <Link href="/desk/paperwork" className="underline">
              Business records
            </Link>
            . It is the written policy the de minimis safe harbor requires.
          </p>
        </section>
      ) : owner ? (
        <TaxActionForm action={signPolicyAction} title={`Capitalization policy — ${year}`} submitLabel="Sign the policy">
          <input type="hidden" name="year" value={year} />
          <p className="text-sm text-muted-foreground">
            The de minimis safe harbor needs this written policy in place.
            Read it, then sign — signing stores it in Business records with
            today&rsquo;s date.
          </p>
          <pre className="whitespace-pre-wrap rounded-lg border border-border bg-background p-4 text-sm">
            {policyPreview}
          </pre>
        </TaxActionForm>
      ) : (
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-base font-semibold text-foreground">
            Capitalization policy — not signed yet
          </h3>
          <p className="mt-1 text-sm">
            The {year} policy is ready. Only the owner can sign it — signing
            stores it in Business records.
          </p>
          <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-border bg-background p-4 text-sm">
            {policyPreview}
          </pre>
        </section>
      )}

      <div className="space-y-4">
        {benefits.rows.map((row) => (
          <RowSection key={row.key} row={row} />
        ))}
      </div>

      <TaxActionForm action={saveElectionsAction} title={`Elections for ${year}`} submitLabel="Save elections">
        <p className="text-sm text-muted-foreground">
          The election statements below ride on the {year} accountant packet for your CPA to
          attach to the return — due {electionStatements.dueOnKey}, or {electionStatements.extensionKey}{" "}
          with an extension. The owner, an admin or your accountant can set the elect-out choice;
          every change is listed for the owner.
        </p>
        {classOptions.map((option) => (
          <label key={option.key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name={`electOut_${option.key}`}
              value="on"
              defaultChecked={electOutChosen.includes(option.key)}
              className="mt-1"
            />
            <span>
              Elect out of bonus depreciation for {option.label} placed in service in {year} —
              it is depreciated under the regular rules instead.
            </span>
          </label>
        ))}
        <input type="hidden" name="year" value={year} />
        <div className="space-y-3">
          <pre className="whitespace-pre-wrap rounded-lg border border-border bg-background p-4 text-sm">
            {electionStatements.deMinimisText}
          </pre>
          {electionStatements.electOutText ? (
            <pre className="whitespace-pre-wrap rounded-lg border border-border bg-background p-4 text-sm">
              {electionStatements.electOutText}
            </pre>
          ) : null}
          {electionStatements.startupNoteText ? (
            <pre className="whitespace-pre-wrap rounded-lg border border-border bg-background p-4 text-sm">
              {electionStatements.startupNoteText}
            </pre>
          ) : null}
        </div>
      </TaxActionForm>

      {canUseSettings ? (
      <TaxActionForm action={saveWriteOffSettingsAction} title="Write-off settings" submitLabel="Save settings">
        <p className="text-sm text-muted-foreground">
          The answers only you can give. They are remembered, and every
          number on this page follows them.
        </p>
        {shareAccounts.map((account) => {
          const answered = businessUsePercentFor(settings?.businessUsePercents ?? null, account.role);
          return (
            <label key={account.role} className="block text-sm">
              <span className="font-medium">{account.name} — business-use share (%)</span>
              <input
                name={`percent_${account.role}`}
                type="number"
                min={0}
                max={100}
                step={1}
                defaultValue={answered ?? ""}
                placeholder="Not answered — 0% is deducted"
                className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2"
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                Shared between business and personal use. Until you answer, none of it is deducted.
              </span>
            </label>
          );
        })}
        <label className="block text-sm">
          <span className="font-medium">Is the business (or its storage address) inside a Colorado enterprise zone?</span>
          <select
            name="enterpriseZone"
            defaultValue={settings?.enterpriseZone ?? "UNKNOWN"}
            className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2"
          >
            <option value="UNKNOWN">Not checked yet</option>
            <option value="YES">Yes — inside a zone</option>
            <option value="NO">No</option>
          </select>
          <span className="mt-1 block text-xs text-muted-foreground">
            Check the state&rsquo;s OEDIT map. Equipment bought for use in the zone can earn a credit, pre-certified before buying.
          </span>
        </label>
        <label className="block text-sm">
          <span className="font-medium">How capitalized equipment is written off</span>
          <select
            name="capitalizationPreference"
            defaultValue={settings?.capitalizationPreference ?? "BONUS"}
            className="mt-1 block w-full rounded-lg border border-border bg-background px-3 py-2"
          >
            <option value="BONUS">Bonus depreciation (the starting value)</option>
            <option value="SECTION179">Section 179 expensing, if my CPA prefers it</option>
          </select>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            name="deMinimisOn"
            value="on"
            defaultChecked={electionOn}
            className="mt-1"
          />
          <span>
            Elect the de minimis safe harbor for {year} — small items at or
            under the rule-book limit per invoice line are expensed. Kept on
            unless your CPA says otherwise.
          </span>
        </label>
        <input type="hidden" name="deMinimisYear" value={year} />
      </TaxActionForm>
      ) : null}
    </div>
  );
}
