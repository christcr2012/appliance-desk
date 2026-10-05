import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatCents } from "@/domains/pricing";
import { formatBusinessDate } from "@/lib/business-date";
import { confirmEarlyReturnAction } from "../../actions";
import {
  choiceFromSettings,
  loadReturnPickup,
  previewEarlyReturn,
  serializePreview,
  type EarlyReturnChoice,
  type EarlyReturnPreview,
} from "@/domains/agreements/early-return";
import { choiceFromFields, fieldsFromChoice, type EarlyReturnFields } from "@/domains/agreements/early-return-form";
import { earlyReturnSettingsFrom } from "@/domains/settings/early-return";

export const metadata = { title: "Equipment returned early" };

type SearchParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function EarlyReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("OWNER", "ADMIN");
  const { id } = await params;
  const query = await searchParams;
  const agreement = await prisma.rentalAgreement.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      termMonths: true,
      paidInFullInAdvance: true,
      customer: { select: { id: true, user: { select: { name: true, email: true } } } },
    },
  });
  if (!agreement) notFound();
  const name = agreement.customer.user.name ?? agreement.customer.user.email;
  const [pickup, resolution, settingsRow] = await Promise.all([
    loadReturnPickup(prisma, id),
    prisma.earlyReturnResolution.findUnique({ where: { agreementId: id } }),
    prisma.businessSettings.findUnique({ where: { id: "singleton" } }),
  ]);
  const settings = earlyReturnSettingsFrom(settingsRow);
  const error = first(query.error);
  const done = first(query.done) === "1";

  const header = (
    <>
      <Link href={`/desk/agreements/${id}`} className="text-sm text-gray-600 hover:underline">
        &larr; Back to the agreement
      </Link>
      <h1 className="mt-2 text-xl font-semibold">Equipment returned early — {name}</h1>
    </>
  );

  if (!pickup) {
    return (
      <div className="max-w-3xl">
        {header}
        <p className="mt-4 text-sm text-gray-700">No equipment has come back from this rental yet, so there is nothing to settle here.</p>
      </div>
    );
  }

  if (resolution && resolution.appliedBy !== "DEFAULTS") {
    return (
      <div className="max-w-3xl">
        {header}
        {done && <p role="status" className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">Saved.</p>}
        <Settled resolution={resolution} />
      </div>
    );
  }

  // The choice shown: what the person picked on this screen, else what was automatically applied, else the standard choices.
  const fallback: EarlyReturnChoice = resolution
    ? {
        billing: resolution.billing as EarlyReturnChoice["billing"],
        unusedDays: resolution.unusedDays as EarlyReturnChoice["unusedDays"],
        feeCents: resolution.feeCents > 0 ? resolution.feeCents : 0,
        ...(resolution.feeReason ? { feeReason: resolution.feeReason } : {}),
      }
    : choiceFromSettings(settings);
  const fields: EarlyReturnFields = {
    billing: first(query.billing),
    unusedDays: first(query.unusedDays),
    fee: first(query.fee),
    feeDollars: first(query.feeDollars),
    feeReason: first(query.feeReason),
  };
  let choice = fallback;
  let problem: string | null = null;
  let preview: EarlyReturnPreview | null = null;
  try {
    choice = choiceFromFields(fields, fallback);
    preview = await previewEarlyReturn(id, choice);
  } catch (e) {
    problem = e instanceof Error ? e.message : "These numbers could not be worked out.";
  }
  const f = fieldsFromChoice(choice);
  const fixed = agreement.termMonths !== null;
  const pickedUp = formatBusinessDate(pickup.pickupDate);

  return (
    <div className="max-w-3xl">
      {header}
      <p className="mt-2 text-sm text-gray-700">
        All of the equipment came back on {pickedUp}, before the rental&rsquo;s agreed ending. Choose what happens, look at the
        numbers, then confirm. Nothing is charged to the customer&rsquo;s card by this screen.
      </p>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
      {resolution && (
        <p className="mt-4 rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900">
          Your standard choices were applied automatically when the pickup was completed. You can still change them while no
          refund or credit has been given and no fee has been paid.
        </p>
      )}
      {agreement.paidInFullInAdvance && (
        <p role="alert" className="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This rental was paid in advance. Settle it from the agreement page instead; this screen does not handle prepaid rentals.
        </p>
      )}

      <form method="get" className="mt-6 space-y-5 rounded-lg border border-gray-200 bg-white p-5">
        <fieldset>
          <legend className="font-medium text-gray-900">What happens to the monthly bill?</legend>
          <label className="mt-2 flex items-start gap-3 text-sm">
            <input type="radio" name="billing" value="KEEP_TO_AGREED_END" defaultChecked={f.billing === "KEEP_TO_AGREED_END"} className="mt-1 h-4 w-4" />
            <span>Keep billing to the agreed ending{fixed ? " (using the early-ending terms the customer signed)" : " (using this rental's ending notice rules, as if asked on the pickup day)"}.</span>
          </label>
          <label className="mt-2 flex items-start gap-3 text-sm">
            <input type="radio" name="billing" value="END_AT_PICKUP" defaultChecked={f.billing === "END_AT_PICKUP"} className="mt-1 h-4 w-4" />
            <span>Stop billing now. The rental ends at pickup and no more monthly charges are made.</span>
          </label>
        </fieldset>
        <fieldset>
          <legend className="font-medium text-gray-900">Days already paid for after pickup (only if billing stops now)</legend>
          {([["KEEP", "Keep them"], ["CREDIT", "Give account credit"], ["REFUND", "Refund them"]] as const).map(([value, label]) => (
            <label key={value} className="mt-2 flex items-start gap-3 text-sm">
              <input type="radio" name="unusedDays" value={value} defaultChecked={f.unusedDays === value} className="mt-1 h-4 w-4" />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
        {fixed ? (
          <fieldset>
            <legend className="font-medium text-gray-900">Early-ending fee</legend>
            <label className="mt-2 flex items-start gap-3 text-sm">
              <input type="radio" name="fee" value="AGREED_TERMS" defaultChecked={f.fee === "AGREED_TERMS"} className="mt-1 h-4 w-4" />
              <span>The fee in the customer&rsquo;s signed terms{preview ? ` (${formatCents(preview.quotedFeeCents)})` : ""}</span>
            </label>
            <label className="mt-2 flex items-start gap-3 text-sm">
              <input type="radio" name="fee" value="NONE" defaultChecked={f.fee === "NONE"} className="mt-1 h-4 w-4" />
              <span>No fee</span>
            </label>
            <label className="mt-2 flex items-start gap-3 text-sm">
              <input type="radio" name="fee" value="CUSTOM" defaultChecked={f.fee === "CUSTOM"} className="mt-1 h-4 w-4" />
              <span>A different amount (needs a written reason)</span>
            </label>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <label htmlFor="feeDollars" className="block text-sm font-medium text-gray-900">Amount in dollars</label>
                <input id="feeDollars" name="feeDollars" inputMode="decimal" defaultValue={f.feeDollars} className="mt-1 min-h-11 w-full rounded-lg border border-control px-3" />
              </div>
              <div>
                <label htmlFor="feeReason" className="block text-sm font-medium text-gray-900">Reason (5 to 500 characters)</label>
                <input id="feeReason" name="feeReason" maxLength={500} defaultValue={f.feeReason} className="mt-1 min-h-11 w-full rounded-lg border border-control px-3" />
              </div>
            </div>
          </fieldset>
        ) : (
          <p className="text-sm text-gray-700">This is a month-to-month rental, so there is never an early-ending fee.</p>
        )}
        <button type="submit" className="min-h-11 rounded-lg border border-control px-4 py-2 text-sm text-primary hover:bg-subtle">
          Show the numbers
        </button>
      </form>

      {problem && <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{problem}</p>}

      {preview && !preview.prepaidNeedsOwner && (
        <section aria-labelledby="numbers" className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
          <h2 id="numbers" className="font-medium text-gray-900">The numbers</h2>
          <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
            <dt className="text-gray-700">Last day the customer is billed</dt>
            <dd className="font-medium">{formatBusinessDate(preview.lastBilledDay)}</dd>
            {f.billing === "END_AT_PICKUP" && (
              <>
                <dt className="text-gray-700">Days already paid for after pickup</dt>
                <dd className="font-medium">{preview.unusedDaysCount}</dd>
                <dt className="text-gray-700">Their value (before tax)</dt>
                <dd className="font-medium">{formatCents(preview.unusedCents)}</dd>
                <dt className="text-gray-700">Tax on that</dt>
                <dd className="font-medium">{formatCents(preview.unusedTaxCents)}</dd>
              </>
            )}
            <dt className="text-gray-700">Early-ending fee (added as an open bill)</dt>
            <dd className="font-medium">{formatCents(preview.feeCents)}</dd>
            <dt className="text-gray-700">
              {f.unusedDays === "CREDIT" ? "Goes to the customer as account credit" : f.unusedDays === "REFUND" ? "Goes back to the customer" : "Goes back to the customer"}
            </dt>
            <dd className="font-medium">{formatCents(preview.refundOrCreditCents)}</dd>
          </dl>
          <form action={confirmEarlyReturnAction} className="mt-5">
            <input type="hidden" name="agreementId" value={id} />
            <input type="hidden" name="billing" value={f.billing} />
            <input type="hidden" name="unusedDays" value={f.unusedDays} />
            <input type="hidden" name="fee" value={f.fee} />
            <input type="hidden" name="feeDollars" value={f.feeDollars} />
            <input type="hidden" name="feeReason" value={f.feeReason} />
            <input type="hidden" name="preview" value={serializePreview(preview)} />
            <button type="submit" className="min-h-11 rounded-lg bg-gray-900 px-5 py-2 text-sm font-semibold text-white">
              Confirm these choices
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

function Settled({ resolution }: { resolution: NonNullable<Awaited<ReturnType<typeof prisma.earlyReturnResolution.findUnique>>> }) {
  return (
    <section className="mt-6 rounded-lg border border-gray-200 bg-white p-5 text-sm">
      <h2 className="font-medium text-gray-900">This early return is settled</h2>
      <ul className="mt-3 space-y-1 text-gray-800">
        <li>Equipment came back on {formatBusinessDate(resolution.pickupDate)}.</li>
        <li>{resolution.billing === "END_AT_PICKUP" ? "Billing stopped at pickup." : "Billing continues to the agreed ending."}</li>
        {resolution.unusedDaysCount > 0 && resolution.billing === "END_AT_PICKUP" && (
          <li>
            {resolution.unusedDaysCount} days were already paid for ({formatCents(resolution.unusedCents + resolution.unusedTaxCents)} with tax):{" "}
            {resolution.creditId ? "given as account credit" : resolution.refundedCents + resolution.refundByHandCents > 0 ? "refunded" : "kept"}.
          </li>
        )}
        {resolution.feeCents > 0 && <li>Early-ending fee: {formatCents(resolution.feeCents)}.</li>}
      </ul>
    </section>
  );
}
