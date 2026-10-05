import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  createTrustedCredentialUserInTx,
  generateUnusedAccountPassword,
  normalizeAccountEmail,
} from "@/lib/account-provisioning";
import { getActiveApplianceOptionsForCustomer } from "@/domains/agreements/active-appliances";
import { sendCustomerActivationEmail } from "@/domains/leads";
import { generateUniqueReferralCode } from "@/domains/referrals";

export { getCustomerTimeline, getCustomerContacts } from "./timeline";
export type { TimelineEntry } from "./timeline";

/**
 * Customers — created either by converting a Lead (src/domains/leads'
 * convertLeadToCustomer) or directly here via createCustomerDirectly.
 * Both paths create the same Better Auth-compatible credential account and
 * Customer relationship inside the same business transaction.
 */
export async function getCustomers() {
  return prisma.customer.findMany({
    where: { archivedAt: null },
    include: {
      user: { select: { name: true, email: true } },
      serviceAddresses: true,
      _count: { select: { rentalAgreements: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

/** How many (non-archived) customers exist — used to clamp the page
 * number before fetching that page's rows (src/domains/pagination.ts). */
export async function getCustomersCount(): Promise<number> {
  return prisma.customer.count({ where: { archivedAt: null } });
}

/** Paginated variant for /desk/customers's own list. */
export async function getCustomersPage(skip: number, pageSize: number) {
  return prisma.customer.findMany({
    where: { archivedAt: null },
    include: {
      user: { select: { name: true, email: true } },
      serviceAddresses: true,
      _count: { select: { rentalAgreements: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take: pageSize,
  });
}

export async function getCustomerById(id: string) {
  await requireRole("OWNER", "ADMIN");
  return prisma.customer.findUnique({
    where: { id },
    include: {
      user: { select: { name: true, email: true } },
      serviceAddresses: true,
      rentalAgreements: {
        include: { serviceAddress: true, lines: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
      jobs: {
        include: { serviceAddress: true },
        orderBy: [{ scheduledAt: "desc" }, { id: "desc" }],
      },
      referredBy: {
        include: {
          referrerCustomer: {
            include: { user: { select: { name: true, email: true } } },
          },
        },
      },
      referralsMade: {
        include: {
          referredCustomer: {
            include: { user: { select: { name: true, email: true } } },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
      credits: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
    },
  });
}

/** The appliances currently assigned to this customer through an ACTIVE
 * rental agreement. */
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
  addresses: NewCustomerAddressInput[];
};

/**
 * Chris adding a customer himself — a landlord who called in, a walk-in,
 * or a property manager already being handled outside the lead form.
 *
 * Security invariant: an unexplained pre-existing CUSTOMER User without a
 * Customer record is never adopted merely because its email matches. Before
 * public signup was disabled, such a row could have been created by someone
 * else. Attaching real business data to that credential would turn an email
 * collision into account pre-hijacking. That legacy state must go through an
 * explicit recovery/claim process instead.
 *
 * For a genuinely new customer, credential User, Customer, addresses and
 * audit evidence all commit in one transaction. The activation email is sent
 * only after that transaction succeeds, so a failed business write cannot
 * leave an invited orphan login.
 */
export async function createCustomerDirectly(
  actingUserId: string,
  input: NewCustomerInput,
) {
  const email = normalizeAccountEmail(input.email);

  const { customer, serviceAddresses } = await prisma.$transaction(async (tx) => {
    const existingUser = await tx.user.findUnique({
      where: { email },
      include: { customer: { select: { id: true } } },
    });

    if (existingUser) {
      if (existingUser.role !== "CUSTOMER") {
        throw new Error(
          `${email} belongs to a staff account, not a customer — use a different email for this customer.`,
        );
      }
      if (existingUser.customer) {
        throw new Error(
          `${email} is already a customer — open their existing record instead of creating a new one.`,
        );
      }
      throw new Error(
        `${email} already has an unattached login. For security, recover or verify that account before linking customer data to it.`,
      );
    }

    const account = await createTrustedCredentialUserInTx(tx, {
      email,
      name: input.name,
      role: "CUSTOMER",
      password: generateUnusedAccountPassword(),
    });

    const customerRow = await tx.customer.create({
      data: {
        userId: account.id,
        phone: input.phone || null,
        isBusiness: input.isBusiness,
        isPropertyManager: input.isPropertyManager,
        companyName: input.companyName || null,
        referralCode: await generateUniqueReferralCode(tx),
      },
    });

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
          email,
          isPropertyManager: input.isPropertyManager,
          addressCount: input.addresses.length,
        },
      },
    });

    return { customer: customerRow, serviceAddresses: addresses };
  });

  const activationEmailSent = await sendCustomerActivationEmail(email);
  return {
    customer,
    serviceAddresses,
    isNewAccount: true,
    activationEmailSent,
  };
}

/** Adding a property to a customer who already exists. */
export async function addServiceAddress(
  customerId: string,
  actingUserId: string,
  input: NewCustomerAddressInput,
) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) {
    throw new Error("Couldn't find that customer.");
  }

  const [address] = await prisma.$transaction([
    prisma.serviceAddress.create({
      data: {
        customerId,
        line1: input.line1,
        line2: input.line2 || null,
        city: input.city,
        state: input.state || "CO",
        zip: input.zip,
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: actingUserId,
        action: "customer.address.add",
        entityType: "Customer",
        entityId: customerId,
        newValue: {
          line1: input.line1,
          city: input.city,
          state: input.state || "CO",
          zip: input.zip,
        },
      },
    }),
  ]);

  return address;
}
