import { ScreenHeader, StatStrip, EmptyState, type Tone } from "@/components/kit";
import { InfoNote } from "@/components/portal/info-note";
import { portalLanguage } from "@/domains/language/portal";
import { portalLabel, portalStatement } from "@/domains/language/portal-copy";
import { businessDateKey, formatMonthYear, relativeBusinessDay } from "@/lib/business-date";
import { getServerSession } from "@/lib/session";
import { getPortalData } from "@/domains/portal";
import { getCustomerStatement } from "@/domains/billing";
import { formatCents } from "@/domains/pricing/money";
import { invoiceStatusLabel, invoiceStatusTone } from "@/lib/status-labels";
import { ManageBillingButton } from "./manage-billing-button";
import { BillsExplorer, type BillRow } from "./bills-explorer";
import { getNextBills } from "@/domains/portal/next-bill";
import { isPayNowEligible } from "@/domains/portal/pay-now";

export const metadata = { title: "Bills" };

const TO_PAY_STATUSES = new Set(["OPEN", "PARTIALLY_PAID", "DELINQUENT", "FAILED"]);

function previousBusinessMonth(): string {
  const current = businessDateKey(new Date()).slice(0, 7);
  const [year, month] = current.split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

function kitTone(status: string): Tone {
  const tone = invoiceStatusTone(status);
  if (tone === "success") return "good";
  if (tone === "progress") return "info";
  if (tone === "stopped") return "danger";
  if (tone === "attention") return "attention";
  return "neutral";
}

function calendarDaysBetween(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(toKey) - Date.parse(fromKey)) / 86_400_000);
}

export default async function AccountBillingPage() {
  const session = await getServerSession();
  const locale = session ? await portalLanguage(session.user.id) : "en";
  const t = (text: Parameters<typeof portalLabel>[1]) => portalLabel(locale, text);
  const customer = session ? await getPortalData(session.user.id) : null;

  if (!customer) {
    return (
      <div className="max-w-3xl">
        <h1 className="pb-4 text-xl font-bold text-ink">{t("Bills")}</h1>
        <EmptyState title={t("No rental account attached to this login")} />
      </div>
    );
  }

  const now = new Date();
  const todayKey = businessDateKey(now);
  const [statement, nextBills] = await Promise.all([
    getCustomerStatement(customer.id, { customerVisible: true }),
    getNextBills(customer.id),
  ]);
  const statementMonth = previousBusinessMonth();
  const [stmtYear, stmtMonth] = statementMonth.split("-").map(Number);
  const statementLabel = `${t("Monthly statement")} (${formatMonthYear(new Date(Date.UTC(stmtYear, stmtMonth - 1, 2)))})`;

  const rows: BillRow[] = [];
  const properties: { id: string; label: string }[] = [];
  for (const property of statement?.properties ?? []) {
    const propertyId = property.serviceAddressId ?? "no-property";
    properties.push({ id: propertyId, label: property.addressLabel });
    for (const invoice of property.invoices) {
      const tab = TO_PAY_STATUSES.has(invoice.status) ? ("topay" as const) : ("paid" as const);
      const dueKey = invoice.dueDate ? businessDateKey(invoice.dueDate) : null;
      const daysLate =
        tab === "topay" && invoice.balanceCents > 0 && dueKey && dueKey < todayKey
          ? calendarDaysBetween(dueKey, todayKey)
          : 0;
      rows.push({
        id: invoice.id,
        number: invoice.invoiceNumber,
        propertyId,
        propertyLabel: property.addressLabel,
        statusLabel: invoiceStatusLabel(invoice.status, locale),
        statusTone: kitTone(invoice.status),
        amountText: invoice.balanceCents > 0 ? formatCents(invoice.balanceCents) : t("Paid"),
        paidText:
          invoice.balanceCents > 0 && invoice.amountPaidCents > 0
            ? `${formatCents(invoice.amountPaidCents)} ${t("paid")}`
            : null,
        dueText:
          daysLate > 0
            ? portalStatement(locale, "daysLate", { count: daysLate, plural: daysLate === 1 ? "" : "s" })
            : invoice.dueDate
              ? `${t("due")} ${relativeBusinessDay(invoice.dueDate, now)}`
              : null,
        dueLate: daysLate > 0,
        tab,
        payNowEligible: isPayNowEligible(invoice, now),
        payAsArranged: invoice.balanceCents > 0 && invoice.isLocalInvoice && !invoice.isShopSale,
      });
    }
  }

  const totalOwed = statement?.totalBalanceCents ?? 0;
  const nextBill = nextBills[0];

  return (
    <div className="max-w-5xl">
      <ScreenHeader
        title={t("Bills")}
        overflow={[
          { kind: "link", label: statementLabel, href: `/api/documents/statement/${statementMonth}` },
        ]}
      />

      <div className="mb-6">
        <ManageBillingButton />
      </div>

      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <StatStrip
            items={[
              {
                label: t("You owe"),
                value: formatCents(totalOwed),
                tone: totalOwed > 0 ? "attention" : "neutral",
              },
              {
                label: t("Next bill"),
                value: nextBill ? formatCents(nextBill.rentCents) : "—",
                sub: nextBill ? `${t("due")} ${relativeBusinessDay(nextBill.date, now)}` : undefined,
              },
            ]}
          />
        </div>
        <span className="pt-3.5">
          <InfoNote
            label={t("Bills can include deposits, fees and tax, so they can differ from your monthly rent.")}
            text={t("Bills can include deposits, fees and tax, so they can differ from your monthly rent.")}
          />
        </span>
      </div>

      {!statement || statement.properties.length === 0 ? (
        <EmptyState title={t("No invoices yet")} />
      ) : (
        <BillsExplorer
          rows={rows}
          properties={properties}
          labels={{
            bills: t("Bills"),
            bill: t("Bill"),
            toPay: t("To pay"),
            paidTab: t("Paid"),
            property: t("Property"),
            allProperties: t("All properties"),
            payNow: t("Pay now"),
            payAsArranged: t("Pay as arranged with Robinson Appliance Rentals."),
            noBillsToPay: t("No bills to pay"),
            noPaidBills: t("No paid bills yet"),
          }}
        />
      )}
    </div>
  );
}
