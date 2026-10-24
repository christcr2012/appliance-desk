"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { createLocalInvoiceCheckout, LocalInvoiceCheckoutError } from "@/domains/billing/local-invoice-checkout";
import { cancelShopSale, createShopSale, SaleTaxBlockedError } from "@/domains/sales";
import { recordManualPayment } from "@/domains/billing";
import { prisma } from "@/lib/prisma";
import { parseDollarInput } from "@/lib/money-ui";
import { businessDateFromKey } from "@/lib/business-date";

export type SaleActionState =
  | { status: "idle" }
  | { status: "success"; id?: string }
  | { status: "error"; message: string; problems?: string[] };

const dollars = z.string().trim().max(12).optional();

function cents(text: string | undefined, label: string): number {
  const value = (text ?? "").replace(/[$,\s]/g, "");
  if (!value) return 0;
  try {
    return parseDollarInput(value, 100_000_00);
  } catch {
    throw new Error(`${label} must be a dollar amount with at most two decimal places (for example 125.50).`);
  }
}

const createSchema = z.object({
  operationKey: z.string().trim().min(8).max(70),
  customerId: z.string().trim().max(64).nullable(),
  walkInName: z.string().trim().max(80).optional(),
  location: z.enum(["PICKUP", "DELIVERED"]),
  serviceAddressId: z.string().trim().max(64).nullable().optional(),
  items: z
    .array(z.object({ partRecordId: z.string().trim().min(1).max(64), quantity: z.number().int().min(1).max(1000), priceDollars: dollars, priceReason: z.string().trim().max(200).optional() }))
    .max(40),
  usedAppliances: z.array(z.object({ applianceId: z.string().trim().min(1).max(64), priceDollars: dollars })).max(40).optional(),
  deliveryDollars: dollars,
  installationDollars: dollars,
  note: z.string().trim().max(300).optional(),
});

export async function createShopSaleAction(raw: unknown): Promise<SaleActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the sale and try again." };
  const v = parsed.data;
  try {
    const result = await createShopSale(session.user.id, {
      operationKey: v.operationKey,
      customerId: v.customerId || null,
      walkInName: v.walkInName,
      location: v.location,
      serviceAddressId: v.serviceAddressId || null,
      items: v.items.map((i) => ({ partRecordId: i.partRecordId, quantity: i.quantity, unitPriceCents: cents(i.priceDollars, "A price"), priceReason: i.priceReason })),
      usedAppliances: (v.usedAppliances ?? []).map((a) => ({ applianceId: a.applianceId, unitPriceCents: cents(a.priceDollars, "A used appliance price") })),
      deliveryChargeCents: cents(v.deliveryDollars, "The delivery charge"),
      installationChargeCents: cents(v.installationDollars, "The installation charge"),
      note: v.note,
    });
    revalidatePath("/desk/sales");
    revalidatePath("/desk/parts");
    revalidatePath("/desk/inventory");
    revalidatePath("/desk/today");
    return { status: "success", id: result.invoiceId };
  } catch (error) {
    if (error instanceof SaleTaxBlockedError) return { status: "error", message: error.message, problems: error.problems };
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't save that sale." };
  }
}

const paymentSchema = z.object({
  invoiceId: z.string().trim().min(1).max(64),
  amountDollars: z.string().trim().max(12),
  method: z.enum(["check", "cash", "bank_transfer", "other"]),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date the payment was received."),
});

export async function recordSalePaymentAction(raw: unknown): Promise<SaleActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = paymentSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the payment and try again." };
  const v = parsed.data;
  try {
    const sale = await prisma.invoice.findFirst({ where: { id: v.invoiceId, saleKind: "SHOP_SALE" }, select: { customerId: true, status: true, amountDueCents: true, amountPaidCents: true } });
    if (!sale) return { status: "error", message: "Couldn't find that sale." };
    if (sale.status === "VOID") return { status: "error", message: "This sale was cancelled, so it can't take a payment." };
    const amountCents = cents(v.amountDollars, "The amount");
    if (amountCents <= 0) return { status: "error", message: "Enter an amount greater than $0." };
    if (amountCents > sale.amountDueCents - sale.amountPaidCents) return { status: "error", message: "That is more than is still owed on this sale." };
    const receivedOn = businessDateFromKey(v.receivedOn);
    if (!receivedOn) return { status: "error", message: "Enter a valid date the payment was received." };
    await recordManualPayment(sale.customerId, session.user.id, { amountCents, method: v.method, receivedOn, invoiceId: v.invoiceId, refuseOverpayment: true });
    revalidatePath("/desk/sales");
    revalidatePath(`/desk/sales/${v.invoiceId}`);
    revalidatePath("/desk/billing");
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't record that payment." };
  }
}

export async function cancelShopSaleAction(invoiceId: string, reason: string): Promise<SaleActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await cancelShopSale(session.user.id, invoiceId, reason);
    revalidatePath("/desk/sales");
    revalidatePath(`/desk/sales/${invoiceId}`);
    revalidatePath("/desk/parts");
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Couldn't cancel that sale." };
  }
}

/** Open Stripe's own card page for what is still owed on a shop sale (nothing about the card passes through this app). */
export async function startSaleCardPaymentAction(invoiceId: string): Promise<{ status: "success"; url: string } | { status: "error"; message: string }> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    const { url } = await createLocalInvoiceCheckout({ kind: "desk", userId: session.user.id }, invoiceId);
    return { status: "success", url };
  } catch (error) {
    return { status: "error", message: error instanceof LocalInvoiceCheckoutError ? error.message : "Couldn't open the card page. Nothing was charged. Please try again." };
  }
}
