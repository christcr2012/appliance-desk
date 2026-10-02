import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { requestInvitationEmail } from "@/lib/password-email";
import { sendEmail } from "@/lib/email";
import {
  createTrustedCredentialUserInTx,
  generateUnusedAccountPassword,
  normalizeAccountEmail,
} from "@/lib/account-provisioning";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { generateUniqueReferralCode, linkReferralIfCodeProvided } from "@/domains/referrals";
import { scoreLead } from "./scoring";
import type { LeadFormInput } from "./schema";
import type { Lead, LeadStatus, Prisma } from "@prisma/client";

/**
 * Creates a Lead from a validated public lead-form submission: computes
 * whether the address is in the service area, scores the lead, saves the
 * Lead + requests + consent in one transaction, then notifies Chris.
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
        referredByCode: input.referralCode || null,
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

export type ManualLeadInput = {
  contactName: string;
  phone: string;
  email?: string | null;
  companyName?: string | null;
  isBusiness?: boolean;
  isPropertyManager?: boolean;
  addressLine1?: string | null;
  city?: string | null;
  zip?: string | null;
  notes?: string | null;
};

/** Lets staff add a phone/walk-in/manual lead. */
export async function createLeadManually(userId: string, input: ManualLeadInput) {
  const { score, reasons, isHighValue } = scoreLead({
    desiredTerm: null,
    quantity: 1,
    isPropertyManager: Boolean(input.isPropertyManager),
    isBusiness: Boolean(input.isBusiness),
  });

  const lead = await prisma.lead.create({
    data: {
      isBusiness: Boolean(input.isBusiness),
      isPropertyManager: Boolean(input.isPropertyManager),
      companyName: input.companyName || null,
      contactName: input.contactName,
      phone: input.phone,
      email: input.email || null,
      notes: input.notes || null,
      addressLine1: input.addressLine1 || null,
      city: input.city || null,
      zip: input.zip || null,
      score,
      scoreReasons: reasons,
      isHighValue,
      createdByUserId: userId,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "lead.create.manual",
      entityType: "Lead",
      entityId: lead.id,
      newValue: { contactName: lead.contactName, phone: lead.phone },
    },
  });

  return lead;
}

const ALL_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "CONVERTED", "LOST"];

export async function getLeadsCount(filter?: { status?: LeadStatus }): Promise<number> {
  return prisma.lead.count({
    where: filter?.status ? { status: filter.status } : undefined,
  });
}

export async function getLeadsPage(
  filter: { status?: LeadStatus } | undefined,
  skip: number,
  pageSize: number,
) {
  return prisma.lead.findMany({
    where: filter?.status ? { status: filter.status } : undefined,
    include: { applianceRequests: { include: { applianceType: true } } },
    orderBy: [{ score: "desc" }, { createdAt: "desc" }],
    skip,
    take: pageSize,
  });
}

export async function getLeadCountsByStatus(): Promise<Record<LeadStatus, number>> {
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

export async function updateLeadStatus(
  userId: string,
  leadId: string,
  status: Exclude<LeadStatus, "CONVERTED">,
  lostReason?: string | null,
) {
  if (status === "LOST" && !lostReason?.trim()) {
    throw new Error("Give a reason before marking this lead lost.");
  }

  const before = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      status,
      lostReason: status === "LOST" ? lostReason!.trim() : null,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "lead.status",
      entityType: "Lead",
      entityId: leadId,
      oldValue: { status: before.status },
      newValue:
        status === "LOST"
          ? { status, lostReason: updated.lostReason }
          : { status },
    },
  });

  return updated;
}

export async function getLeadNotes(leadId: string) {
  return prisma.leadNote.findMany({
    where: { leadId },
    include: { author: { select: { name: true, email: true } } },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function addLeadNote(
  leadId: string,
  authorId: string,
  body: string,
): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error("A note can't be empty.");
  }
  await prisma.leadNote.create({
    data: { leadId, authorId, body: trimmed },
  });
}

export function canConvertLead(
  lead: Pick<Lead, "status" | "email">,
): { ok: true } | { ok: false; reason: string } {
  if (lead.status === "CONVERTED") {
    return {
      ok: false,
      reason: "This lead has already been converted to a customer.",
    };
  }
  if (!z.string().trim().email().safeParse(lead.email).success) {
    return {
      ok: false,
      reason:
        "Add a valid email address for this lead before converting — a customer account needs one to sign in.",
    };
  }
  return { ok: true };
}

// Compatibility export for existing callers/tests. The implementation now
// lives in the server-only account provisioning module so customer, staff,
// lead and CI setup cannot drift into different credential-creation paths.
export { generateUnusedAccountPassword } from "@/lib/account-provisioning";

export async function sendCustomerActivationEmail(email: string): Promise<boolean> {
  const normalized = normalizeAccountEmail(email);
  return requestInvitationEmail(normalized, () =>
    auth.api.requestPasswordReset({
      body: { email: normalized, redirectTo: "/reset-password" },
    }),
  );
}

export type ConvertLeadInTxOptions = {
  /** Used by a public estimate approval when a phone-entered lead had no
   * email until the approver supplied one. The email write, lead claim,
   * account/customer creation and caller's surrounding estimate mutation can
   * then all share one transaction. */
  emailOverride?: string | null;
};

/**
 * Transaction-capable lead conversion primitive. Callers that need lead
 * conversion to be atomic with another state machine (notably estimate
 * approval) use this directly; ordinary desk conversion uses the wrapper
 * below.
 *
 * Security invariant: an existing CUSTOMER User with no trusted Customer
 * relationship is NOT adopted. That state could predate the closure of the
 * public sign-up endpoint, so matching an email string is insufficient proof
 * that the credential belongs to this real customer.
 */
export async function convertLeadToCustomerInTx(
  tx: Prisma.TransactionClient,
  userId: string | null,
  leadId: string,
  options: ConvertLeadInTxOptions = {},
) {
  const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });

  const effectiveEmail = options.emailOverride?.trim() || lead.email;
  const check = canConvertLead({ ...lead, email: effectiveEmail });
  if (!check.ok) {
    throw new Error(check.reason);
  }
  const email = normalizeAccountEmail(effectiveEmail as string);

  const claim = await tx.lead.updateMany({
    where: { id: lead.id, status: lead.status },
    data: {
      status: "CONVERTED",
      ...(options.emailOverride ? { email } : {}),
    },
  });
  if (claim.count !== 1) {
    throw new Error(
      "This lead changed while converting. Refresh its record before trying again.",
    );
  }

  let isNewAccount = false;
  let account = await tx.user.findUnique({
    where: { email },
    include: { customer: true },
  });

  if (account && account.role !== "CUSTOMER") {
    throw new Error(
      `${email} belongs to a staff account, not a customer — use a different email for this lead first.`,
    );
  }

  if (account && !account.customer) {
    throw new Error(
      `${email} already has an unattached login. For security, recover or verify that account before linking customer data to it.`,
    );
  }

  if (!account) {
    const created = await createTrustedCredentialUserInTx(tx, {
      email,
      name: lead.contactName,
      role: "CUSTOMER",
      password: generateUnusedAccountPassword(),
    });
    account = { ...created, customer: null };
    isNewAccount = true;
  }

  let customerRow = account.customer;
  if (!customerRow) {
    customerRow = await tx.customer.create({
      data: {
        userId: account.id,
        phone: lead.phone,
        isBusiness: lead.isBusiness,
        isPropertyManager: lead.isPropertyManager,
        companyName: lead.companyName,
        referralCode: await generateUniqueReferralCode(tx),
      },
    });
    await linkReferralIfCodeProvided(tx, customerRow.id, lead.referredByCode);
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
    data: {
      status: "CONVERTED",
      convertedCustomerId: customerRow.id,
      ...(options.emailOverride ? { email } : {}),
    },
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

  return { customer: customerRow, isNewAccount, email };
}

export async function convertLeadToCustomer(
  userId: string | null,
  leadId: string,
) {
  const result = await prisma.$transaction((tx) =>
    convertLeadToCustomerInTx(tx, userId, leadId),
  );

  const activationEmailSent = result.isNewAccount
    ? await sendCustomerActivationEmail(result.email)
    : false;
  return {
    customer: result.customer,
    isNewAccount: result.isNewAccount,
    activationEmailSent,
  };
}

export type LeadSourceBreakdownRow = {
  source: string;
  total: number;
  converted: number;
  conversionRate: number;
};

export async function getLeadSourceBreakdown(): Promise<LeadSourceBreakdownRow[]> {
  const leads = await prisma.lead.findMany({
    select: { howHeard: true, status: true },
  });

  const groups = new Map<string, { total: number; converted: number }>();
  for (const lead of leads) {
    const source = lead.howHeard?.trim() || "Not given";
    const group = groups.get(source) ?? { total: 0, converted: 0 };
    group.total += 1;
    if (lead.status === "CONVERTED") group.converted += 1;
    groups.set(source, group);
  }

  return [...groups.entries()]
    .map(([source, { total, converted }]) => ({
      source,
      total,
      converted,
      conversionRate: total > 0 ? converted / total : 0,
    }))
    .sort((a, b) => b.total - a.total);
}
