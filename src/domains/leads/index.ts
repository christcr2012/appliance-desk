import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { generateUniqueReferralCode, linkReferralIfCodeProvided } from "@/domains/referrals";
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

/**
 * Lets staff add a lead directly — a phone call, a walk-in, or the
 * "start an estimate for someone new" flow on /desk/estimates/new
 * (createEstimateDraftForNewLead below calls this first). Flagged by
 * Chris (2026-09-29) as a real gap: the only way a Lead could exist was
 * through the public contact form, so a call-in inquiry had nowhere to
 * go except straight to "Add a customer" — skipping the lead pipeline
 * (scoring, status tracking, follow-up) entirely.
 *
 * Deliberately lighter than createLead above: no appliance-type
 * selection, no desired term, no privacy-consent checkbox — none of
 * that applies when Chris himself is the one typing this in, not a
 * website visitor agreeing to a form. `desiredTerm`/`quantity` are left
 * at scoreLead's own defaults (month-to-month, 1) so this lead can
 * still be scored and shown in the pipeline even with minimal detail;
 * Chris can fill in the rest later from the lead's own page. No
 * "new lead" notification email either — he's the one creating it.
 */
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

// ---------------------------------------------------------------------------
// /desk/leads — browsing, status changes, and lead → customer conversion.
// See docs/BUSINESS-RULES.md ("How the business operates at launch").
// ---------------------------------------------------------------------------

const ALL_STATUSES: LeadStatus[] = ["NEW", "CONTACTED", "CONVERTED", "LOST"];

/** Total Lead count matching the same optional status filter as getLeads —
 * used to clamp the page number for /desk/leads's paginated view. See
 * src/domains/pagination.ts. */
export async function getLeadsCount(filter?: { status?: LeadStatus }): Promise<number> {
  return prisma.lead.count({ where: filter?.status ? { status: filter.status } : undefined });
}

/** Paginated variant of getLeads. */
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
 * status this function accepts on its own.
 *
 * `lostReason` is required when (and only meaningful when) `status` is
 * `"LOST"` (2026-09-29, Chris's CRM brainstorm — docs/DECISIONS.md): a
 * `LOST` status with no reason tells Chris nothing he can act on later
 * (too expensive? wrong service area? never called back?), so this
 * throws rather than silently accepting a blank one. Any reason given
 * for a non-LOST status is ignored rather than erroring — the UI simply
 * never sends one for the other statuses. */
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
      lostReason: status === "LOST" ? lostReason!.trim() : before.lostReason,
    },
  });

  await prisma.auditLog.create({
    data: {
      userId,
      action: "lead.status",
      entityType: "Lead",
      entityId: leadId,
      oldValue: { status: before.status },
      newValue: status === "LOST" ? { status, lostReason: updated.lostReason } : { status },
    },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// A lead's own contact/communication history — "called Tuesday, no
// answer," "emailed the estimate again" — the same LeadNote pattern
// CustomerNote already gives customers (src/domains/customers/timeline.ts),
// extended to leads (2026-09-29, Chris's CRM brainstorm — see
// docs/DECISIONS.md). Deliberately its own small set of functions rather
// than a full timeline merge like getCustomerTimeline: a lead's page
// doesn't yet have the several related-entity types (agreements, jobs,
// maintenance requests) that make a merged timeline worthwhile for a
// customer — just notes plus the lead's own AuditLog history, which
// /desk/activity already lets Chris filter to by entity.
// ---------------------------------------------------------------------------

export async function getLeadNotes(leadId: string) {
  return prisma.leadNote.findMany({
    where: { leadId },
    include: { author: { select: { name: true, email: true } } },
    orderBy: [{ createdAt: "desc" }],
  });
}

export async function addLeadNote(leadId: string, authorId: string, body: string): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new Error("A note can't be empty.");
  }
  await prisma.leadNote.create({
    data: { leadId, authorId, body: trimmed },
  });
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

/** Better Auth's signUpEmail requires *some* password to create the
 * account with, but nobody ever needs to know or use this one — the
 * customer sets their own real password via the activation email (see
 * sendCustomerActivationEmail below), the same way a forgotten password
 * is reset. Random and immediately discarded on purpose. Exported so
 * src/domains/customers' direct-customer-creation flow (Chris adding a
 * customer himself, not via lead conversion) can create an account the
 * same safe way instead of duplicating this. */
export function generateUnusedAccountPassword(): string {
  return randomBytes(24).toString("base64url");
}

/** Sends a new or existing customer the same "set your password" email
 * Better Auth's forgot-password flow uses (see src/lib/auth.ts's
 * sendResetPassword) — reused deliberately as the account-activation
 * mechanism instead of inventing a separate invite-token system (Phase
 * 6A item 2). Best-effort: a failed send is logged (see sendEmail) but
 * never throws, since the account itself is already created either way
 * and Chris can use "Resend activation email" from the customer's page
 * to try again. Returns whether the send was attempted without error —
 * not a delivery guarantee, same meaning as sendEmail's own result
 * elsewhere in this codebase. */
export async function sendCustomerActivationEmail(email: string): Promise<boolean> {
  try {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: "/reset-password" },
    });
    return true;
  } catch (error) {
    console.error("[leads] Failed to send customer activation email", error);
    return false;
  }
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
 *
 * Chris never learns or relays a customer's password (Phase 6A item 2):
 * a brand-new account gets an unusable random password that's discarded
 * immediately, and the customer is emailed a "set your password" link
 * (sendCustomerActivationEmail) so they activate their own account. See
 * "Resend activation email" on /desk/customers/[id] for re-sending it
 * later if the first email didn't arrive or the link expired.
 *
 * `userId` is null when this runs as a side effect of the customer's
 * own public approval of a lead-started estimate (approveEstimate in
 * src/domains/estimates) rather than a staff click on /desk/leads —
 * there's no staff user to attribute that conversion to, and
 * AuditLog.userId is nullable for exactly this kind of system/public
 * action.
 */
export async function convertLeadToCustomer(userId: string | null, leadId: string) {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

  const check = canConvertLead(lead);
  if (!check.ok) {
    throw new Error(check.reason);
  }
  const email = lead.email as string; // canConvertLead guarantees this

  let account = await prisma.user.findUnique({ where: { email } });
  let activationEmailSent = false;
  const isNewAccount = !account;

  if (
    account &&
    (account.role === "OWNER" || account.role === "ADMIN" || account.role === "STAFF")
  ) {
    throw new Error(
      `${email} belongs to a staff account, not a customer — use a different email for this lead first.`,
    );
  }

  if (!account) {
    const signUp = await auth.api.signUpEmail({
      body: { email, password: generateUnusedAccountPassword(), name: lead.contactName },
    });
    // emailVerified is set true immediately (Task #70, docs/DECISIONS.md
    // 2026-09-28) — the activation email below already proves the
    // customer controls this inbox (they can't set a password without
    // clicking its link), so Better Auth's own "verify your email" step
    // would be a redundant second confirmation of the same fact, not a
    // real additional safeguard here (there's no self-serve signup path
    // in this app for requireEmailVerification to actually guard).
    account = await prisma.user.update({
      where: { id: signUp.user.id },
      data: { role: "CUSTOMER", emailVerified: true },
    });
    activationEmailSent = await sendCustomerActivationEmail(email);
  }

  const customer = await prisma.$transaction(async (tx) => {
    // Claim the unchanged stage before creating customer/address records.
    // Postgres serializes competing updates to this row; a second click
    // sees the converted stage and cannot create another property or audit.
    // Any later failure rolls the claim back with the rest of the transaction.
    const claim = await tx.lead.updateMany({
      where: { id: lead.id, status: lead.status },
      data: { status: "CONVERTED" },
    });
    if (claim.count !== 1) {
      throw new Error("This lead changed while converting. Refresh its record before trying again.");
    }
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
          referralCode: await generateUniqueReferralCode(tx),
        },
      });
      // Only a brand-new customer can be "referred" — an existing
      // account converting from a second lead already has whatever
      // referral link it started with, if any.
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

  return { customer, isNewAccount, activationEmailSent };
}

// ---------------------------------------------------------------------------
// Lead-source ROI reporting (2026-09-29, Chris's CRM brainstorm — see
// docs/DECISIONS.md). Lead.howHeard has been captured on every lead
// since Phase 2, but until this nothing ever added it up — it just sat
// on each lead's own detail page, one at a time. Feeds a new section on
// /desk/reports.
// ---------------------------------------------------------------------------

export type LeadSourceBreakdownRow = {
  source: string;
  total: number;
  converted: number;
  conversionRate: number; // 0–1; 0 when total is 0 to avoid a NaN in the UI
};

/** Every lead grouped by how they heard about us, with how many of each
 * group actually converted to a customer — highest lead count first.
 * "Not given" groups leads with no `howHeard` on file (most likely
 * staff-entered ones — see `createLeadManually` — since the public form
 * requires an answer). Small, in-memory grouping rather than a raw SQL
 * GROUP BY: this table is leads, not transactions, so it'll stay small
 * enough for this to be fine for a long time — revisit if it ever isn't
 * (same reasoning `getAllEstimates`'s own comment gives). */
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

