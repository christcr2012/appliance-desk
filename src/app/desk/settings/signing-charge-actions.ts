"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseDollarInput } from "@/lib/money-ui";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { requireRole } from "@/lib/session";
import { businessDateKey } from "@/lib/business-date";
import { parseSetupTaxOwnerApproval } from "@/domains/billing/setup-tax-owner-approval";
import { cancelPendingDecisionChangesInTx } from "@/domains/decisions/pending";
export type SigningSettingsState = { error: string; success: string };
const get = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};
export async function saveSigningChargeSettingsAction(
  _previous: SigningSettingsState, form: FormData,
): Promise<SigningSettingsState> {
  const session = await requireRole("OWNER");
  try {
    const reset = form.get("operation") === "restore";
    const setupFeeCents = reset ? 4500 : parseDollarInput(get(form, "setupFeeDollars"), 1_000_000);
    const threshold = reset ? 5 : Number(get(form, "largeOrderMachineThreshold"));
    const refundHours = reset ? 72 : Number(get(form, "largeOrderCancellationFullRefundHours"));
    if (!Number.isInteger(refundHours) || refundHours < 1 || refundHours > 720)
      throw new Error("Enter a full-refund window from 1 to 720 hours.");
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 1000)
      throw new Error("Enter a machine threshold from 1 to 1,000.");
    const planningTreatment = reset ? "TAXABLE" : get(form, "setupFeeTaxPlanningTreatment");
    if (!["TAXABLE", "NOT_TAXABLE"].includes(planningTreatment))
      throw new Error("Choose a valid provisional tax planning setting.");
    const taxTreatment = reset ? "UNDECIDED" : get(form, "setupFeeTaxTreatment");
    if (!["UNDECIDED", "TAXABLE", "NOT_TAXABLE"].includes(taxTreatment))
      throw new Error("Choose a valid tax decision.");
    const note = reset ? "" : get(form, "setupFeeTaxDecisionNote");
    if (note.length > 500) throw new Error("Record no more than 500 characters of CPA guidance.");
    const decisionTime = new Date();
    const approval = parseSetupTaxOwnerApproval({
      treatment: taxTreatment, note,
      confirmedOn: get(form, "setupFeeTaxConfirmedOn"),
      effectiveFrom: get(form, "setupFeeTaxEffectiveFrom"),
      reference: get(form, "setupFeeTaxAdviserReference"),
      attested: form.get("setupFeeTaxOwnerAttested") === "on",
    }, decisionTime);
    const expected = new Date(get(form, "updatedAt"));
    if (!Number.isFinite(expected.getTime())) throw new Error("Refresh settings before saving.");
    const businessRequiresDownPayment = reset || form.get("businessRequiresDownPayment") === "on";
    await prisma.$transaction(async (tx) => {
      await assertActiveTeamActor(tx, session.user.id, ["OWNER"]);
      await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = ${"singleton"} FOR UPDATE`;
      const settings = await tx.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
      if (expected.getTime() !== settings.updatedAt.getTime()) throw new Error("Settings changed. Refresh and try again.");
      if (settings.setupFeeTaxPlanningTreatment !== planningTreatment)
        await cancelPendingDecisionChangesInTx(tx, session.user.id, ["IN-79"],
          "A newer setup-fee tax setting was saved in Signing charges.");
      const appliesNow = taxTreatment === "UNDECIDED" ||
        (approval.setupFeeTaxEffectiveFrom !== null &&
          approval.setupFeeTaxEffectiveFrom.getTime() <= new Date().getTime());
      await tx.businessSettings.update({
        where: { id: "singleton" },
        data: {
          administrativeSetupFeeCents: setupFeeCents,
          largeOrderMachineThreshold: threshold,
          largeOrderCancellationFullRefundHours: refundHours,
          businessRequiresDownPayment,
          setupFeeTaxPlanningTreatment: planningTreatment,
          ...(appliesNow ? {
            setupFeeTaxTreatment: taxTreatment,
            setupFeeTaxDecisionNote: approval.setupFeeTaxDecisionNote,
            setupFeeTaxConfirmedOn: approval.setupFeeTaxConfirmedOn,
            setupFeeTaxEffectiveFrom: approval.setupFeeTaxEffectiveFrom,
            setupFeeTaxApprovedAt: approval.setupFeeTaxApprovedAt,
            setupFeeTaxAdviserReference: approval.setupFeeTaxAdviserReference,
          } : {}),
        },
      });
      const now = new Date();
      const effectiveFromKey = approval.setupFeeTaxEffectiveFrom
        ? approval.setupFeeTaxEffectiveFrom.toISOString().slice(0, 10)
        : businessDateKey(now);
      if (taxTreatment === "UNDECIDED") {
        // A revocation also cancels previously scheduled successor policies.
        await tx.setupFeeTaxDecisionVersion.updateMany({
          where: { effectiveFromKey: { gt: businessDateKey(now) }, cancelledAt: null },
          data: { cancelledAt: now },
        });
      }
      await tx.setupFeeTaxDecisionVersion.create({ data: {
        treatment: taxTreatment,
        effectiveFromKey,
        cpaConfirmedOnKey: approval.setupFeeTaxConfirmedOn?.toISOString().slice(0, 10) ?? null,
        decisionNote: approval.setupFeeTaxDecisionNote,
        adviserReference: approval.setupFeeTaxAdviserReference,
        ownerApprovedAt: now,
        ownerUserId: session.user.id,
      }});
      await tx.auditLog.create({ data: {
        userId: session.user.id, action: "settings.signing_charges.update",
        entityType: "BusinessSettings", entityId: "singleton",
        oldValue: {
          fee: settings.administrativeSetupFeeCents,
          threshold: settings.largeOrderMachineThreshold,
          cancellationHours: settings.largeOrderCancellationFullRefundHours,
          business: settings.businessRequiresDownPayment,
          taxTreatment: settings.setupFeeTaxTreatment,
          planningTreatment: settings.setupFeeTaxPlanningTreatment,
          taxReview: settings.setupFeeTaxApprovedAt?.toISOString() ?? "UNDECIDED",
        },
        newValue: { fee: setupFeeCents, threshold, cancellationHours: refundHours, business: businessRequiresDownPayment,
          taxTreatment, planningTreatment, futureEffective: !appliesNow,
          decisionNote: approval.setupFeeTaxDecisionNote,
          cpaConfirmedOn: approval.setupFeeTaxConfirmedOn?.toISOString() ?? null,
          effectiveFrom: approval.setupFeeTaxEffectiveFrom?.toISOString() ?? null,
          ownerApprovedAt: approval.setupFeeTaxApprovedAt?.toISOString() ?? null,
          adviserReference: approval.setupFeeTaxAdviserReference },
      }});
    });
    revalidatePath("/desk/settings");
    return { error: "", success: "Signing settings and any approved policy revision saved. Separate customer and LIVE payment gates remain enforced." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { error: /^(Enter|Choose|Record|Confirm|Provide|Refresh|Settings changed|The dollar amount)/.test(message)
      ? message : "Could not save settings. Review and try again.", success: "" };
  }
}
