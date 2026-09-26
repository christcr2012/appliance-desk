import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { scoreLead } from "./scoring";
import type { LeadFormInput } from "./schema";
import type { Lead, LeadStatus } from "@prisma/client";

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

// ---------------------------------------------------------------------------
// /desk/leads — browsing, status changes, and lead → customer conversion.
// See docs/BUSINESS-RULES.md ("How the business operates at launch").
// ---------------------------------------------------------------------------

const ALL_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "CONVERTED", "LOST"];

/** All leads, optionally filtered to one status, newest/highest-score first
 * so the leads Chris most needs to act on surface at the top. Used by
 * /desk/leads. */
export async function getLeads(filter?: { status?: LeadStatus }) {
  return prisma.lead.findMany({
    where: filter?.status ? { status: filter.status } : undefined,
    include: { applianceRequests: { include: { applianceType: true } } },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
  });
}

/** Count of leads in each status, for the /desk/leads status tabs and the
 * dashboard's "needing attention" number. */
export async function getLeadCountsByStatus(): Promise<
  Record<LeadStatus, number>
> {
  const counts = await prisma.lead.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const result = Object.fromEntries(
    ALL_STATUSES.map((s) => [s, 0]),
  ) as Record<LeadStatus, number>;
  for (const row of counts) {
    result[row.status] = row._count._all;
  }
  return result;
}

export async function getLeadById(id: string) {
  return prisma.lead.findUnique({
    where: { id },
    include: { applianceRequests: { include: { applianceType: true } } },
  });
}

/** Changes a lead's status (e.g. marking it Contacted or Lost) and logs who
 * did it. Converting to a customer is a separate, more involved operation —
 * see convertLeadToCustomer below — so "CONVERTED" is deliberately not a
 * status this function accepts on its own. */
export async function updateLeadStatus(
  userId: string,
  leadId: string,
  status: Exclude<LeadStatus, "CONVERTED">,
) {
  const before = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: { status },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "lead.status",
      entityType: "Lead",
      entityId: leadId,
      oldValue: { status: before.status },
      newValue: { status },
    },
  });

  return updated;
}

/** Pure guard used before converting a lead — no database access, so it's
 * safe to unit-test directly (see tests/leads.test.ts) despite the rest of
 * this file needing a real database. Kept in sync with the checks
 * convertLeadToCustomer actually enforces below. */
export function canConvertLead(
  lead: Pick<Lead, "status" | "email">,
): { ok: true } | { ok: false; reason: string } {
  if (lead.status === "CONVERTED") {
    return {
      ok: false,
      reason: "This lead has already been converted to a customer.",
    };
  }
  if (!lead.email) {
    return {
      ok: false,
      reason:
        "Add an email address for this lead before converting — a customer account needs one to sign in.",
    };
  }
  return { ok: true };
}

/** A one-time password only ever shown once, right after conversion, so
 * Chris can hand it to a new customer if he wants them signed in
 * immediately. Not emailed automatically — there's no "set your own
 * password" invite flow yet (see docs/ROADMAP.md); that's real work for
 * the customer-portal phase, not something to fake here. Random, not
 * memorable on purpose: this is a one-time credential Chris relays once,
 * not a password anyone is expected to remember. */
function generateTempPassword(): string {
  return randomBytes(12).toString("base64url");
}

/**
 * Converts a Lead into a Customer (+ User account + ServiceAddress),
 * per docs/BUSINESS-RULES.md step 3 ("Chris converts the lead into a
 * Customer... one click carries the lead's info over"). Deliberately
 * stops short of creating a RentalAgreement — that's Phase 4
 * (e-signature, job scheduling) and needs its own real workflow, not a
 * default guessed here.
 *
 * If a User with this email already exists (e.g. the customer already
 * has an account, or this lead's contact converted before under the
 * same email), reuses it instead of erroring — conversion should never
 * fail just because the lookup happened twice.
 */
export async function convertLeadToCustomer(userId: string, leadId: string) {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  const check = canConvertLead(lead);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  const email = lead.email as string; // canConvertLead guarantees this

  let account = await prisma.user.findUnique({ where: { email } });
  let tempPassword: string | null = null;

  if (account && (account.role === "OWNER" || account.role === "ADMIN")) {
    throw new Error(
      `${email} belongs to a staff account, not a customer — use a different email for this lead first.`,
    );
  }

  if (!account) {
    tempPassword = generateTempPassword();
    const signUp = await auth.api.signUpEmail({
      body: { email, password: tempPassword, name: lead.contactName },
    });
    account = await prisma.user.update({
      where: { id: signUp.user.id },
      data: { role: "CUSTOMER" },
    });
  }

  const customer = await prisma.$transaction(async (tx) => {
    let customerRow = await tx.customer.findUnique({
      where: { userId: account!.id },
    });

    if (!customerRow) {
      customerRow = await tx.customer.create({
        data: {
          userId: account!.id,
          phone: lead.phone,
          isBusiness: lead.isBusiness,
          isPropertyManager: lead.isPropertyManager,
          companyName: lead.companyName,
        },
      });
    }

    if (lead.addressLine1 && lead.city && lead.zip) {
      await tx.serviceAddress.create({
        data: {
          customerId: customerRow.id,
          line1: lead.addressLine1,
          city: lead.city,
          zip: lead.zip,
        },
      });
    }

    await tx.lead.update({
      where: { id: lead.id },
      data: { status: "CONVERTED", convertedCustomerId: customerRow.id },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "lead.convert",
        entityType: "Lead",
        entityId: lead.id,
        oldValue: { status: lead.status },
        newValue: { status: "CONVERTED", customerId: customerRow.id },
      },
    });

    return customerRow;
  });

  return { customer, tempPassword };
}
