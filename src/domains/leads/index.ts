import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { scoreLead } from "./scoring";
import type { LeadFormInput } from "./schema";

/**
 * Creates a Lead from a validated public lead-form submission: computes
 * whether the address is in the service area, scores the lead (see
 * scoring.ts), saves the Lead + its appliance requests + a consent
 * record in one transaction, and emails Chris a notification
 * (docs/BUSINESS-RULES.md: "Chris is notified immediately by email of
 * every new lead. High-value leads are flagged as such.").
 *
 * A failed notification email never fails the submission — the visitor
 * sees success once the lead is safely in the database either way.
 */
export async function createLead(input: LeadFormInput) {
  const settings = await getBusinessSettings();
  const serviceArea = parseServiceArea(settings);

  const zip = input.zip?.trim() || null;
  const city = input.city?.trim() || null;
  const inServiceArea =
    zip || city
      ? Boolean(
          (zip && serviceArea.zips.includes(zip)) ||
            (city &&
              serviceArea.cities.some(
                (c) => c.toLowerCase() === city.toLowerCase(),
              )),
        )
      : null;

  const { score, reasons, isHighValue } = scoreLead({
    desiredTerm: input.desiredTerm,
    quantity: input.quantity,
    isPropertyManager: input.isPropertyManager,
    isBusiness: input.accountType === "business",
  });

  const lead = await prisma.$transaction(async (tx) => {
    const created = await tx.lead.create({
      data: {
        isBusiness: input.accountType === "business",
        isPropertyManager: input.isPropertyManager,
        companyName: input.companyName || null,
        contactName: input.contactName,
        phone: input.phone,
        email: input.email || null,
        bestTimeToContact: input.bestTimeToContact || null,
        howHeard: input.howHeard || null,
        desiredTerm: input.desiredTerm,
        desiredStartDate: input.desiredStartDate
          ? new Date(input.desiredStartDate)
          : null,
        quantity: input.quantity,
        notes: input.notes || null,
        addressLine1: input.addressLine1 || null,
        city,
        zip,
        inServiceArea,
        consentedAt: new Date(),
        score,
        scoreReasons: reasons,
        isHighValue,
        applianceRequests: {
          create: input.applianceTypeIds.map((applianceTypeId) => ({
            applianceTypeId,
            quantity: input.quantity,
          })),
        },
      },
      include: { applianceRequests: { include: { applianceType: true } } },
    });

    await tx.consentRecord.create({
      data: {
        kind: "lead_form_privacy",
        details: {
          leadId: created.id,
          source: "public-lead-form",
        },
      },
    });

    return created;
  });

  const notifyTo = process.env.LEAD_NOTIFICATION_EMAIL || settings.publicEmail;
  const applianceSummary = lead.applianceRequests
    .map((r) => `${r.quantity}x ${r.applianceType.name}`)
    .join(", ");

  await sendEmail({
    to: notifyTo,
    subject: isHighValue
      ? `New HIGH-VALUE lead: ${lead.contactName}`
      : `New lead: ${lead.contactName}`,
    text: [
      `A new lead came in from the website${isHighValue ? " (flagged HIGH VALUE)" : ""}.`,
      "",
      `Name: ${lead.contactName}${lead.companyName ? ` (${lead.companyName})` : ""}`,
      `Phone: ${lead.phone}`,
      `Email: ${lead.email ?? "(not given)"}`,
      `Best time to contact: ${lead.bestTimeToContact ?? "(not given)"}`,
      `Wants: ${applianceSummary}`,
      `Term: ${lead.desiredTerm ?? "(not given)"}`,
      `Location: ${[lead.city, lead.zip].filter(Boolean).join(", ") || "(not given)"}${inServiceArea === false ? " — OUTSIDE configured service area" : ""}`,
      `How they heard about us: ${lead.howHeard ?? "(not given)"}`,
      `Notes: ${lead.notes ?? "(none)"}`,
      "",
      `Score: ${score} — ${reasons.join("; ")}`,
      "",
      "Review it in the Owner Desk under Leads.",
    ].join("\n"),
  });

  return lead;
}
