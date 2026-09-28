import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getActiveApplianceOptionsForCustomer } from "@/domains/agreements/active-appliances";
import {
  generateUnusedAccountPassword,
  sendCustomerActivationEmail,
} from "@/domains/leads";

export { getCustomerTimeline, getCustomerContacts } from "./timeline";
export type { TimelineEntry } from "./timeline";

/**
 * Customers — created either by converting a Lead (src/domains/leads'
 * convertLeadToCustomer) or, since the "add a customer directly"
 * request (2026-09-27, in response to the Astra design review flagging
 * that Chris had no way to add a customer without an inbound lead —
 * see docs/DECISIONS.md), directly here via createCustomerDirectly.
 * Both paths create the same shape of record (a login-capable User +
 * Customer, optionally with ServiceAddress rows) and share the same
 * account-creation helpers so there's exactly one way a customer
 * account gets created, not two that could drift apart.
 */
export async function getCustomers() {
  return prisma.customer.findMany({
    where: { archivedAt: null },
    include: {
      user: { select: { name: true, email: true } },
      serviceAddresses: true,
      _count: { select: { rentalAgreements: true } },
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

/** How many (non-archived) customers exist — used to clamp the page
 * number before fetching that page's rows (src/domains/pagination.ts). */
export async function getCustomersCount(): Promise<number> {
  return prisma.customer.count({ where: { archivedAt: null } });
}

/** Paginated variant for /desk/customers's own list, as the customer
 * roster grows past a page — see src/domains/pagination.ts.
 * getCustomers() above stays unpaginated for the callers that need
 * every customer at once (the rental builder wizard's picker, the new-
 * job form's picker). */
export async function getCustomersPage(skip: number, pageSize: number) {
  return prisma.customer.findMany({
    where: { archivedAt: null },
    include: {
      user: { select: { name: true, email: true } },
      serviceAddresses: true,
      _count: { select: { rentalAgreements: true } },
    },
    orderBy: [{ createdAt: "desc" }],
    skip,
    take: pageSize,
  });
}

export async function getCustomerById(id: string) {
  return prisma.customer.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, email: true } },
      serviceAddresses: true,
      rentalAgreements: {
        include: { serviceAddress: true, lines: true },
        orderBy: [{ createdAt: "desc" }],
      },
      jobs: {
        include: { serviceAddress: true },
        orderBy: [{ scheduledAt: "desc" }],
      },
    },
  });
}

/** The appliances currently assigned to this customer through an ACTIVE
 * rental agreement — used to prefill the appliance checkboxes when
 * scheduling a job linked to one of their maintenance requests. Staff-side
 * mirror of src/domains/portal/index.ts's getPortalApplianceOptions; both
 * go through the same shared helper in
 * src/domains/agreements/active-appliances.ts so "what counts as this
 * customer's current rental equipment" can never drift between the two. */
export async function getCustomerApplianceOptions(customerId: string) {
  return getActiveApplianceOptionsForCustomer(customerId);
}

export type NewCustomerAddressInput = {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  zip: string;
};

export type NewCustomerInput = {
  name: string;
  email: string;
  phone?: string;
  isBusiness: boolean;
  isPropertyManager: boolean;
  companyName?: string;
  /** One or more properties to put on file up front — a household
     customer typically adds just the one they're renting at, while a
     property manager (per the Astra brief's portfolio-account ask) can
     list every property they manage right away instead of one at a
     time later. The schema already supported many addresses per
     customer (ServiceAddress[] on Customer) before this existed; this
     is what actually lets Chris use that from the desk. */
  addresses: NewCustomerAddressInput[];
};

/** Chris adding a customer himself — a landlord who called in, a
 * walk-in, a property manager he's already been talking to outside the
 * website — rather than waiting for a Lead to convert. Mirrors
 * convertLeadToCustomer's account-creation logic exactly (same "someone
 * already has this email" and "that email belongs to staff" checks,
 * same random-password + activation-email pattern) so there's one
 * consistent way a customer ends up with a working login, whichever
 * path created them. */
export async function createCustomerDirectly(
  actingUserId: string,
  input: NewCustomerInput,
) {
  let account = await prisma.user.findUnique({ where: { email: input.email } });

  if (
    account &&
    (account.role === "OWNER" || account.role === "ADMIN" || account.role === "STAFF")
  ) {
    throw new Error(
      `${input.email} belongs to a staff account, not a customer — use a different email for this customer.`,
    );
  }

  if (account) {
    const existing = await prisma.customer.findUnique({
      where: { userId: account.id },
    });
    if (existing) {
      throw new Error(
        `${input.email} is already a customer — open their existing record instead of creating a new one.`,
      );
    }
  }

  const isNewAccount = !account;
  let activationEmailSent = false;

  if (!account) {
    const signUp = await auth.api.signUpEmail({
      body: {
        email: input.email,
        password: generateUnusedAccountPassword(),
        name: input.name,
      },
    });
    account = await prisma.user.update({
      where: { id: signUp.user.id },
      data: { role: "CUSTOMER" },
    });
    activationEmailSent = await sendCustomerActivationEmail(input.email);
  }

  const { customer, serviceAddresses } = await prisma.$transaction(async (tx) => {
    const customerRow = await tx.customer.create({
      data: {
        userId: account!.id,
        phone: input.phone || null,
        isBusiness: input.isBusiness,
        isPropertyManager: input.isPropertyManager,
        companyName: input.companyName || null,
      },
    });

    // Returned to the caller (used by the rental builder wizard —
    // src/app/desk/agreements/new — to move straight into picking this
    // brand-new customer's just-created address for the agreement,
    // without a second round-trip to look it up).
    const addresses = [];
    for (const address of input.addresses) {
      addresses.push(
        await tx.serviceAddress.create({
          data: {
            customerId: customerRow.id,
            line1: address.line1,
            line2: address.line2 || null,
            city: address.city,
            state: address.state || "CO",
            zip: address.zip,
          },
        }),
      );
    }

    await tx.auditLog.create({
      data: {
        userId: actingUserId,
        action: "customer.create",
        entityType: "Customer",
        entityId: customerRow.id,
        newValue: {
          email: input.email,
          isPropertyManager: input.isPropertyManager,
          addressCount: input.addresses.length,
        },
      },
    });

    return { customer: customerRow, serviceAddresses: addresses };
  });

  return { customer, serviceAddresses, isNewAccount, activationEmailSent };
}
