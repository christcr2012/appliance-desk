"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import {
  addSalvagedParts, completeRetiredPlan, completeRetiredPlans, recordScrapPayment, reopenRetiredPlan, setRetiredPlan,
  voidScrapPayment, setRetiredFollowUpDays, type SalvageLine,
} from "@/domains/inventory/retired-plans";
import { parseDollarInput } from "@/lib/money-ui";

export type RetiredActionState = { status: "idle" } | { status: "success" } | { status: "error"; message: string };

const fail = (error: unknown, fallback: string): RetiredActionState => ({
  status: "error",
  message: error instanceof Error ? error.message : fallback,
});

function refresh(applianceId?: string) {
  revalidatePath("/desk/inventory/retired");
  revalidatePath("/desk/inventory");
  revalidatePath("/desk/today");
  revalidatePath("/desk/parts");
  if (applianceId) revalidatePath(`/desk/inventory/${applianceId}`);
}

const planSchema = z.object({
  choice: z.enum(["SELL", "STRIP", "SCRAP", "DISPOSE", "OTHER"]).nullable(),
  note: z.string().trim().max(300).optional(),
});

export async function setRetiredPlanAction(applianceId: string, raw: unknown): Promise<RetiredActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = planSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: "Choose what's next for it." };
  try {
    await setRetiredPlan(session.user.id, applianceId, parsed.data);
    refresh(applianceId);
    return { status: "success" };
  } catch (error) {
    return fail(error, "Couldn't save that choice.");
  }
}

const doneSchema = z.object({
  doneOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date it happened."),
  note: z.string().trim().max(300).optional(),
  remainder: z.enum(["SCRAPPED", "THROWN_AWAY"]).optional(),
});

export async function completeRetiredPlanAction(applianceId: string, raw: unknown): Promise<RetiredActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = doneSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the details." };
  try {
    await completeRetiredPlan(session.user.id, applianceId, { doneOnKey: parsed.data.doneOn, note: parsed.data.note, remainder: parsed.data.remainder });
    refresh(applianceId);
    return { status: "success" };
  } catch (error) {
    return fail(error, "Couldn't mark that done.");
  }
}

export async function completeRetiredPlansAction(applianceIds: string[], doneOn: string): Promise<RetiredActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doneOn)) return { status: "error", message: "Enter the date it happened." };
  try {
    await completeRetiredPlans(session.user.id, applianceIds, doneOn);
    refresh();
    return { status: "success" };
  } catch (error) {
    return fail(error, "Couldn't mark those done.");
  }
}

export async function reopenRetiredPlanAction(applianceId: string, reason: string): Promise<RetiredActionState> {
  const session = await requireRole("OWNER");
  try {
    await reopenRetiredPlan(session.user.id, applianceId, reason);
    refresh(applianceId);
    return { status: "success" };
  } catch (error) {
    return fail(error, "Couldn't reopen that.");
  }
}

const salvageSchema = z.object({
  operationKey: z.string().trim().min(8).max(70),
  lines: z
    .array(
      z.union([
        z.object({ partRecordId: z.string().trim().min(1).max(64), quantity: z.number().int().min(1).max(100), note: z.string().trim().max(200).optional() }),
        z.object({
          newPart: z.object({ modelNumber: z.string().trim().min(1).max(80), partNumber: z.string().trim().min(1).max(80), partName: z.string().trim().max(120).optional() }),
          quantity: z.number().int().min(1).max(100),
          note: z.string().trim().max(200).optional(),
        }),
      ]),
    )
    .min(1, "Add at least one part.")
    .max(30),
});

export async function addSalvagedPartsAction(applianceId: string, raw: unknown): Promise<RetiredActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = salvageSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the parts and try again." };
  try {
    await addSalvagedParts(session.user.id, applianceId, parsed.data.operationKey, parsed.data.lines as SalvageLine[]);
    refresh(applianceId);
    return { status: "success" };
  } catch (error) {
    return fail(error, "Couldn't add those parts.");
  }
}

const scrapSchema = z.object({
  operationKey: z.string().trim().min(8).max(70),
  receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date you got the money."),
  amountDollars: z.string().trim().max(14),
  yardName: z.string().trim().min(1, "Enter the scrap yard's name.").max(120),
  note: z.string().trim().max(300).optional(),
  depositAccountId: z.string().trim().min(1, "Choose the account the money went into.").max(64),
});

export async function recordScrapPaymentAction(raw: unknown): Promise<RetiredActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  const parsed = scrapSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message ?? "Check the details." };
  const v = parsed.data;
  let amountCents: number;
  try {
    amountCents = parseDollarInput(v.amountDollars.replace(/[$,\s]/g, ""), 1_000_000_00);
  } catch {
    return { status: "error", message: "Enter the amount as dollars with at most two decimal places (for example 125.50)." };
  }
  try {
    await recordScrapPayment(session.user.id, {
      operationKey: v.operationKey, receivedOnKey: v.receivedOn, amountCents, yardName: v.yardName, note: v.note, depositAccountId: v.depositAccountId,
    });
    refresh();
    revalidatePath("/desk/books");
    return { status: "success" };
  } catch (error) {
    return fail(error, "Couldn't save that entry.");
  }
}

export async function voidScrapPaymentAction(id: string, reason: string): Promise<RetiredActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await voidScrapPayment(session.user.id, id, reason);
    refresh();
    revalidatePath("/desk/books");
    return { status: "success" };
  } catch (error) {
    return fail(error, "Couldn't void that entry.");
  }
}

export async function setRetiredFollowUpDaysAction(days: number): Promise<RetiredActionState> {
  const session = await requireRole("OWNER", "ADMIN");
  try {
    await setRetiredFollowUpDays(session.user.id, days);
    refresh();
    return { status: "success" };
  } catch (error) {
    return fail(error, "Couldn't save that setting.");
  }
}
