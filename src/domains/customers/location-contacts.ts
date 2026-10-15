import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { subMonths } from "date-fns";
import { prisma } from "@/lib/prisma";

type Tx = Prisma.TransactionClient;
export type LocationActor = {
  userId: string;
  role: "OWNER" | "ADMIN" | "CUSTOMER";
  customerId?: string;
};

export const permissionSchema = z.object({
  deliveryPickup: z.boolean(),
  maintenance: z.boolean(),
  swaps: z.boolean(),
  appointmentConfirmer: z.enum(["CLIENT", "TENANT"]),
  copyClient: z.boolean(),
}).strict();
export type LocationPermission = z.infer<typeof permissionSchema>;
export const DENIED_PERMISSION: LocationPermission = Object.freeze({
  deliveryPickup: false, maintenance: false, swaps: false,
  appointmentConfirmer: "CLIENT", copyClient: true,
});
export const siteSchema = z.object({
  unitLabel: z.string().trim().max(80),
  accessNotes: z.string().trim().max(2000),
  override: permissionSchema.nullable(),
}).strict();
export const personSchema = z.object({
  name: z.string().trim().min(1).max(160),
  role: z.enum(["TENANT", "ONSITE_CONTACT"]),
  phone: z.string().trim().max(35),
  email: z.union([z.literal(""), z.string().email().max(200)]),
  preferredLanguage: z.enum(["en", "es"]),
  startedAt: z.union([z.literal(""), z.iso.date()]),
}).strict();

export function effectiveLocationPermission(account: unknown, override: unknown): LocationPermission {
  // Corrupt/missing evidence never creates permission. An explicit site override
  // replaces the account default, rather than combining grants implicitly.
  const p = permissionSchema.safeParse(override === null || override === undefined ? account : override);
  return p.success ? p.data : DENIED_PERMISSION;
}
export function mayContactTenant(policy: LocationPermission, topic: "deliveryPickup" | "maintenance" | "swaps") {
  return policy[topic];
}
/** Client permission alone is never a tenant SMS grant. Real SMS uses COM-L independent consent. */
export function tenantTextPermittedWithoutConsent(): false { return false; }

function assertOwnCustomer(actor: LocationActor, customerId: string) {
  if (actor.role === "CUSTOMER" && actor.customerId !== customerId)
    throw new Error("This location is not on your account.");
}
async function requireCustomer(tx: Tx, actor: LocationActor, customerId: string) {
  assertOwnCustomer(actor, customerId);
  const owner = await tx.customer.findFirst({
    where: { id: customerId, archivedAt: null },
    select: { id: true },
  });
  if (!owner) throw new Error("Customer not available.");
}
async function requireAddress(tx: Tx, actor: LocationActor, customerId: string, addressId: string) {
  await requireCustomer(tx, actor, customerId);
  const row = await tx.serviceAddress.findFirst({
    where: { id: addressId, customerId },
    select: { id: true },
  });
  if (!row) throw new Error("This location is not on your account.");
}
async function event(tx: Tx, actor: LocationActor, action: string,
  entityId: string, evidence: Prisma.InputJsonObject) {
  await tx.auditLog.create({ data: {
    userId: actor.userId, action, entityType: "ServiceAddress",
    entityId, newValue: evidence,
  } });
}
export async function locationWorkspace(actor: LocationActor, customerId: string) {
  assertOwnCustomer(actor, customerId);
  const row = await prisma.customer.findFirst({
    where: { id: customerId, archivedAt: null },
    select: {
      id: true, locationContactPolicy: true, locationContactPolicyAt: true,
      serviceAddresses: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true, line1: true, line2: true, city: true, state: true, zip: true,
          unitLabel: true, accessNotes: true, locationContactPolicy: true,
          locationContactPolicyAt: true,
          locationContacts: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { id: true, name: true, role: true, phone: true, email: true,
              preferredLanguage: true, startedAt: true, endedAt: true, erasedAt: true,
              privacyHoldAt: true, privacyHoldReason: true },
          },
        },
      },
    },
  });
  if (!row) throw new Error("Customer not available.");
  return {
    ...row,
    permission: effectiveLocationPermission(row.locationContactPolicy, null),
    serviceAddresses: row.serviceAddresses.map(site => ({
      ...site,
      // A customer's ordinary tenancy view does not disclose internal legal hold
      // deliberation or owner-only review references.
      locationContacts: site.locationContacts.map(contact => ({
        ...contact,
        privacyHoldAt: actor.role === "CUSTOMER" ? null : contact.privacyHoldAt,
        privacyHoldReason: actor.role === "CUSTOMER" ? null : contact.privacyHoldReason,
      })),
      permission: effectiveLocationPermission(row.locationContactPolicy, site.locationContactPolicy),
    })),
  };
}
export async function saveAccountLocationPermission(actor: LocationActor, customerId: string, raw: unknown) {
  const policy = permissionSchema.parse(raw);
  await prisma.$transaction(async tx => {
    await requireCustomer(tx, actor, customerId);
    const at = new Date();
    await tx.customer.update({ where: { id: customerId }, data: {
      locationContactPolicy: policy, locationContactPolicyAt: at,
      locationContactPolicyByUserId: actor.userId,
    } });
    await event(tx, actor, "location.permission.account", customerId,
      { permission: policy, at: at.toISOString() });
  });
}
export async function saveLocationDetails(actor: LocationActor,
  customerId: string, addressId: string, raw: unknown) {
  const data = siteSchema.parse(raw);
  await prisma.$transaction(async tx => {
    await requireAddress(tx, actor, customerId, addressId);
    const at = new Date();
    await tx.serviceAddress.update({ where: { id: addressId }, data: {
      unitLabel: data.unitLabel || null, accessNotes: data.accessNotes || null,
      locationContactPolicy: data.override === null ? Prisma.DbNull : data.override,
      locationContactPolicyAt: at, locationContactPolicyByUserId: actor.userId,
    } });
    // Never store a gate code or tenant PII in an immutable audit stream.
    await event(tx, actor, "location.details.update", addressId,
      { hasAccessNotes: !!data.accessNotes, unitLabelChanged: true,
        permission: data.override ?? null, at: at.toISOString() });
  });
}
export async function addLocationPerson(actor: LocationActor,
  customerId: string, addressId: string, raw: unknown) {
  const fields = personSchema.parse(raw);
  return prisma.$transaction(async tx => {
    await requireAddress(tx, actor, customerId, addressId);
    const created = await tx.locationContact.create({ data: {
      serviceAddressId: addressId, name: fields.name, role: fields.role,
      phone: fields.phone || null, email: fields.email || null,
      preferredLanguage: fields.preferredLanguage,
      startedAt: fields.startedAt ? new Date(fields.startedAt + "T00:00:00.000Z") : null,
    } });
    await event(tx, actor, "location.person.add", addressId,
      { contactId: created.id, role: fields.role });
    return created.id;
  });
}
export async function moveOutLocationPerson(actor: LocationActor, customerId: string,
  addressId: string, contactId: string, inspection: boolean) {
  await prisma.$transaction(async tx => {
    await requireAddress(tx, actor, customerId, addressId);
    const existing = await tx.locationContact.findFirst({
      where: { id: contactId, serviceAddressId: addressId, endedAt: null, erasedAt: null,
        OR: [{ startedAt: null }, { startedAt: { lte: new Date() } }] },
      select: { startedAt: true },
    });
    if (!existing || (existing.startedAt && existing.startedAt > new Date()))
      throw new Error("This contact has already left or has an invalid tenancy start.");
    const updated = await tx.locationContact.updateMany({
      where: { id: contactId, serviceAddressId: addressId, endedAt: null, erasedAt: null,
        OR: [{ startedAt: null }, { startedAt: { lte: new Date() } }] },
      data: { endedAt: new Date(), repairTokenHash: null, repairTokenExpiresAt: null },
    });
    if (updated.count !== 1) throw new Error("This contact already moved out.");
    if (inspection) {
      // Only a To do: no rental termination, billing update, booked appointment or automatic payment.
      await tx.staffTask.create({ data: {
        customerId, createdByUserId: actor.userId,
        note: "Check appliances when occupant changes at property " + addressId,
        priority: "HIGH", sourceKey: "tenant-turnover:" + contactId,
      } });
    }
    await event(tx, actor, "location.person.end", addressId,
      { contactId, inspection });
  });
}
export async function eraseExpiredTenantPII(now = new Date(), limit = 250) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid batch.");
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" }, select: { tenantContactRetentionMonths: true,
      tenantContactPurgeApprovedAt: true, tenantContactPurgeApprovalReference: true },
  });
  // Deployment and recorded owner/adviser clearance are independent. Do not silently
  // turn on irreversible production PII erasure when the migration lands.
  if (process.env.TENANT_PII_PURGE_ENABLED !== "true" ||
    !settings?.tenantContactPurgeApprovedAt ||
    !settings.tenantContactPurgeApprovalReference) return 0;
  const months = settings?.tenantContactRetentionMonths ?? 12;
  if (!Number.isSafeInteger(months) || months < 1 || months > 120)
    throw new Error("Invalid retention policy; erasure denied.");
  const cutoff = subMonths(now, months);
  return prisma.$transaction(async tx => {
    const rows = await tx.locationContact.findMany({
      where: { endedAt: { lte: cutoff }, erasedAt: null, privacyHoldAt: null,
        // Any recorded repair is potentially relevant to a claim/dispute. Keep the
        // occupant until a reviewed hold release process exists; never infer closure.
        serviceAddress: { maintenanceRequests: { none: {} } } },
      select: { id: true }, orderBy: [{ endedAt: "asc" }, { id: "asc" }], take: limit,
    });
    if (!rows.length) return 0;
    const changed = await tx.locationContact.updateMany({
      where: { id: { in: rows.map(x => x.id) }, endedAt: { lte: cutoff },
        erasedAt: null, privacyHoldAt: null,
        serviceAddress: { maintenanceRequests: { none: {} } } },
      data: { name: null, phone: null, email: null, preferredLanguage: "en",
        repairTokenHash: null, repairTokenExpiresAt: null, erasedAt: now },
    });
    await tx.auditLog.create({ data: { action: "location.retention.erasure",
      entityType: "LocationContact", newValue: { count: changed.count, retentionMonths: months } } });
    return changed.count;
  });
}
export async function setLocationRetention(actor: LocationActor, months: number) {
  if (actor.role !== "OWNER") throw new Error("Owner permission required.");
  if (!Number.isSafeInteger(months) || months < 1 || months > 120)
    throw new Error("Use 1–120 whole months.");
  await prisma.$transaction(async tx => {
    const old = await tx.businessSettings.findUnique({
      where: { id: "singleton" }, select: { tenantContactRetentionMonths: true },
    });
    await tx.businessSettings.upsert({
      where: { id: "singleton" }, create: { tenantContactRetentionMonths: months },
      update: { tenantContactRetentionMonths: months },
    });
    await tx.auditLog.create({ data: { userId: actor.userId,
      action: "location.retention.change", entityType: "BusinessSettings", entityId: "singleton",
      oldValue: { months: old?.tenantContactRetentionMonths ?? 12 }, newValue: { months } } });
  });
}

/** Read-only policy preview; include blocked rows so an owner can investigate
 * holds/claims without any irreversible write or revealing PII to staff/clients. */
export async function previewTenantRetentionErasure(actor: LocationActor, now = new Date()) {
  if (actor.role !== "OWNER") throw new Error("Owner permission required.");
  const settings = await prisma.businessSettings.findUnique({ where: { id: "singleton" },
    select: { tenantContactRetentionMonths: true, tenantContactPurgeApprovedAt: true,
      tenantContactPurgeApprovalReference: true } });
  const months = settings?.tenantContactRetentionMonths ?? 12;
  const cutoff = subMonths(now, months);
  const [eligible, legalHolds, repairHolds] = await Promise.all([
    prisma.locationContact.count({ where: { endedAt: { lte: cutoff },
      erasedAt: null, privacyHoldAt: null,
      serviceAddress: { maintenanceRequests: { none: {} } } } }),
    prisma.locationContact.count({ where: { endedAt: { lte: cutoff },
      erasedAt: null, privacyHoldAt: { not: null } } }),
    prisma.locationContact.count({ where: { endedAt: { lte: cutoff },
      erasedAt: null, privacyHoldAt: null,
      serviceAddress: { maintenanceRequests: { some: {} } } } }),
  ]);
  return { retentionMonths: months, eligible, legalHolds, repairHolds,
    approved: !!settings?.tenantContactPurgeApprovedAt &&
      !!settings.tenantContactPurgeApprovalReference,
    deploymentEnabled: process.env.TENANT_PII_PURGE_ENABLED === "true" };
}

/** Recording an approval reference does not activate the cron: the deployment
 * operator must separately enable TENANT_PII_PURGE_ENABLED after genuine review. */
export async function recordTenantPurgeReview(actor: LocationActor, reference: string) {
  if (actor.role !== "OWNER") throw new Error("Owner permission required.");
  const source = z.string().trim().min(12).max(500).parse(reference);
  await prisma.$transaction(async tx => {
    await tx.businessSettings.upsert({ where: { id: "singleton" },
      create: { tenantContactPurgeApprovedAt: new Date(),
        tenantContactPurgeApprovalReference: source, tenantContactPurgeApprovedBy: actor.userId },
      update: { tenantContactPurgeApprovedAt: new Date(),
        tenantContactPurgeApprovalReference: source, tenantContactPurgeApprovedBy: actor.userId },
    });
    await event(tx, actor, "location.retention.review_recorded", "singleton",
      { reference: source, automaticActivation: false });
  });
}
export async function setTenantPrivacyHold(actor: LocationActor, customerId: string,
  addressId: string, contactId: string, reason: string | null, releaseNote?: string) {
  if (actor.role !== "OWNER" && actor.role !== "ADMIN")
    throw new Error("Owner/admin required for hold decisions.");
  const note = reason === null ? null : z.string().trim().min(8).max(500).parse(reason);
  const release = reason === null ? z.string().trim().min(8).max(500).parse(releaseNote) : null;
  await prisma.$transaction(async tx => {
    await requireAddress(tx, actor, customerId, addressId);
    const changed = await tx.locationContact.updateMany({
      where: { id: contactId, serviceAddressId: addressId, erasedAt: null },
      data: { privacyHoldAt: note ? new Date() : null, privacyHoldReason: note },
    });
    if (changed.count !== 1) throw new Error("Contact not found.");
    await event(tx, actor, note ? "location.retention.hold" : "location.retention.release",
      addressId, { contactId, reason: note, releaseReason: release });
  });
}
export const IMPORT_HEADERS =
  "street,unit,city,state,zip,unitLabel,tenantName,tenantPhone,tenantEmail,language";
export type ImportRow = {
  street: string; unit: string; city: string; state: string; zip: string;
  unitLabel: string; tenantName: string; tenantPhone: string; tenantEmail: string; language: string;
};
/** CSV quotes, doubled quotes and newlines; reject formulas and incomplete rows. */
export function parseLocationCsv(text: string): ImportRow[] {
  if (text.length > 120000) throw new Error("Import too large (120 KB maximum).");
  let quoted = false, column = "", row: string[] = [];
  const parsed: string[][] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { column += '"'; i++; }
      else if (quoted) quoted = false;
      else if (!column) quoted = true;
      else throw new Error("Invalid CSV quotes.");
    } else if (quoted) column += char;
    else if (char === ",") { row.push(column); column = ""; }
    else if (char === "\n") { row.push(column); parsed.push(row); row = []; column = ""; }
    else if (char !== "\r") column += char;
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  if (column || row.length) { row.push(column); parsed.push(row); }
  if ((parsed.shift() ?? []).join(",") !== IMPORT_HEADERS) throw new Error("Incorrect CSV columns.");
  if (!parsed.length || parsed.length > 200) throw new Error("Supply 1–200 locations.");
  const columns = IMPORT_HEADERS.split(",") as (keyof ImportRow)[];
  const result: ImportRow[] = [];
  const seen = new Set<string>();
  for (const [i, cells] of parsed.entries()) {
    if (cells.length !== columns.length) throw new Error("Wrong column count on row " + (i + 2));
    const obj = Object.fromEntries(columns.map((k, pos) => [k, cells[pos].trim()])) as ImportRow;
    if (!obj.street || !obj.city || !obj.state || !obj.zip ||
        obj.street.length > 200 || obj.unit.length > 200 || obj.city.length > 100 ||
        obj.unitLabel.length > 80 || !/^[A-Z]{2}$/i.test(obj.state) ||
        !/^[0-9]{5}(-[0-9]{4})?$/.test(obj.zip))
      throw new Error("Invalid address on row " + (i + 2));
    if (!obj.tenantName && (obj.tenantPhone || obj.tenantEmail))
      throw new Error("Missing tenant name on row " + (i + 2));
    if (obj.tenantName) personSchema.parse({
      name: obj.tenantName, role: "TENANT", phone: obj.tenantPhone,
      email: obj.tenantEmail, preferredLanguage: obj.language || "en", startedAt: "",
    });
    if (Object.values(obj).some(v => /^[=+@-]/.test(v)))
      throw new Error("Spreadsheet formula on row " + (i + 2));
    const key = addressKey({ line1: obj.street, line2: obj.unit,
      city: obj.city, state: obj.state, zip: obj.zip });
    if (seen.has(key)) throw new Error("Duplicate property on row " + (i + 2));
    seen.add(key);
    result.push(obj);
  }
  return result;
}
/** Preview both per-row syntax AND collisions with the account's actual sites.
 * Commit re-checks in SERIALIZABLE; the preview is never a write authorization. */
export async function previewLocationCsv(actor: LocationActor, customerId: string, csv: string) {
  if (actor.role !== "OWNER" && actor.role !== "ADMIN")
    throw new Error("Only owner/admin may preview a portfolio import.");
  const records = parseLocationCsv(csv);
  const digest = createHash("sha256").update(JSON.stringify(records)).digest("hex");
  await prisma.$transaction(async tx => {
    await requireCustomer(tx, actor, customerId);
    const committed = await tx.locationPortfolioImport.findUnique({
      where: { customerId_digest: { customerId, digest } },
    });
    if (committed) return; // A previously committed identical file is already applied.

    await requireCustomer(tx, actor, customerId);
    const existing = await tx.serviceAddress.findMany({
      select: { customerId: true, line1: true, line2: true, city: true, state: true, zip: true },
    });
    const keys = new Set(existing.map(addressKey));
    const collision = records.find(row => keys.has(addressKey({
      line1: row.street, line2: row.unit, city: row.city, state: row.state, zip: row.zip,
    })));
    if (collision) throw new Error("An imported property already exists in the portfolio: " + collision.street);
  });
  return records;
}
function addressKey(row: { line1: string; line2?: string | null; city: string; state: string; zip: string }) {
  return [row.line1, row.line2 ?? "", row.city, row.state, row.zip]
    .map(part => part.trim().replace(/\s+/g, " ").toLowerCase()).join("|");
}
export async function importLocationCsv(actor: LocationActor, customerId: string, csv: string) {
  if (actor.role !== "OWNER" && actor.role !== "ADMIN")
    throw new Error("Only owner/admin may approve portfolio imports.");
  const records = parseLocationCsv(csv);
  const digest = createHash("sha256").update(JSON.stringify(records)).digest("hex");
  return prisma.$transaction(async tx => {
    // A successful prior commit is a no-op even if the HTTP response was lost.
    const previous = await tx.locationPortfolioImport.findUnique({
      where: { customerId_digest: { customerId, digest } },
    });
    if (previous) { await requireCustomer(tx, actor, customerId); return previous.importedCount; }

    await requireCustomer(tx, actor, customerId);
    const existing = await tx.serviceAddress.findMany({
      select: { customerId: true, line1: true, line2: true, city: true, state: true, zip: true },
    });
    const keys = new Set(existing.map(addressKey));
    for (const entry of records) {
      if (keys.has(addressKey({ line1: entry.street, line2: entry.unit,
        city: entry.city, state: entry.state, zip: entry.zip })))
        throw new Error("An imported property already exists in the portfolio.");
    }
    for (const entry of records) {
      const site = await tx.serviceAddress.create({ data: {
        customerId, line1: entry.street, line2: entry.unit || null,
        city: entry.city, state: entry.state.toUpperCase(), zip: entry.zip,
        unitLabel: entry.unitLabel || null,
      } });
      if (entry.tenantName) await tx.locationContact.create({ data: {
        serviceAddressId: site.id, name: entry.tenantName, role: "TENANT",
        phone: entry.tenantPhone || null, email: entry.tenantEmail || null,
        preferredLanguage: entry.language || "en",
      } });
    }
    await tx.locationPortfolioImport.create({ data: {
      customerId, digest, importedCount: records.length, approvedByUserId: actor.userId,
    } });
    await event(tx, actor, "location.import", customerId, { count: records.length, digest });
    return records.length;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 });
}
export async function getJobLocationPrivacy(actor: { userId: string; role: string }, jobId: string) {
  if (!["OWNER", "ADMIN", "STAFF"].includes(actor.role)) return null;
  const row = await prisma.job.findFirst({
    where: { id: jobId,
      ...(actor.role === "STAFF" ? { assignedToUserId: actor.userId,
        status: { in: ["SCHEDULED", "IN_PROGRESS"] as const } } : {}),
    },
    select: { customerId: true, type: true, serviceAddress: {
      select: { customerId: true, unitLabel: true, accessNotes: true,
        locationContactPolicy: true,
        customer: { select: { locationContactPolicy: true } },
        locationContacts: { where: { endedAt: null, erasedAt: null,
          OR: [{ startedAt: null }, { startedAt: { lte: new Date() } }] },
          select: { id: true, name: true, role: true, phone: true, email: true,
            preferredLanguage: true } } },
    } },
  });
  if (!row?.serviceAddress || row.customerId !== row.serviceAddress.customerId) return null;
  const { customer, locationContactPolicy, ...site } = row.serviceAddress;
  const permission = effectiveLocationPermission(customer.locationContactPolicy, locationContactPolicy);
  const topic = row.type === "SWAP" ? "swaps" : row.type === "MAINTENANCE_VISIT"
    ? "maintenance" : "deliveryPickup";
  const contactAllowed = mayContactTenant(permission, topic);
  // OWNER/ADMIN can administer site contacts, but assigned staff cannot call a
  // tenant on a topic the paying client has not authorized.
  return { ...site, permission, contactAllowed,
    locationContacts: actor.role === "STAFF" && !contactAllowed
      ? site.locationContacts.map(person => ({ ...person, phone: null, email: null }))
      : site.locationContacts,
  };
}


/** Scoped, single-use repair intake; caller copies link manually. No message is sent. */
export async function createTenantRepairLink(actor: LocationActor, customerId: string,
  addressId: string, contactId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  await prisma.$transaction(async tx => {
    await requireAddress(tx, actor, customerId, addressId);
    const site = await tx.serviceAddress.findUniqueOrThrow({
      where: { id: addressId },
      select: { locationContactPolicy: true,
        customer: { select: { locationContactPolicy: true } } },
    });
    const policy = effectiveLocationPermission(site.customer.locationContactPolicy, site.locationContactPolicy);
    if (!policy.maintenance) throw new Error("Client has not authorized tenant maintenance contact at this location.");
    const updated = await tx.locationContact.updateMany({
      where: { id: contactId, serviceAddressId: addressId, endedAt: null, erasedAt: null,
        OR: [{ startedAt: null }, { startedAt: { lte: new Date() } }] },
      data: { repairTokenHash: hash, repairTokenExpiresAt: new Date(Date.now() + 7 * 86400000) },
    });
    if (updated.count !== 1) throw new Error("Choose a current contact.");
    await event(tx, actor, "location.repair_link.created", addressId, { contactId, expiresInDays: 7 });
  });
  return "/tenant/repair/" + token;
}
function repairHash(token: string): string | null {
  if (!/^[a-zA-Z0-9_-]{32,120}$/.test(token)) return null;
  // Hash search avoids exposing the original token in stored records.
  return createHash("sha256").update(token).digest("hex");
}
export async function tenantRepairOptions(token: string) {
  const hash = repairHash(token);
  if (!hash) return null;
  const person = await prisma.locationContact.findFirst({
    where: { repairTokenHash: hash, repairTokenExpiresAt: { gt: new Date() },
      endedAt: null, erasedAt: null,
        OR: [{ startedAt: null }, { startedAt: { lte: new Date() } }] },
    select: { id: true, serviceAddress: {
      select: { id: true, customerId: true, line1: true, city: true, unitLabel: true,
        locationContactPolicy: true, customer: {
          select: { archivedAt: true, locationContactPolicy: true } },
      } },
    },
  });
  const site = person?.serviceAddress;
  if (!site || site.customer.archivedAt ||
    !effectiveLocationPermission(site.customer.locationContactPolicy, site.locationContactPolicy).maintenance)
    return null;
  const agreements = await prisma.rentalAgreement.findMany({
    where: { customerId: site.customerId, serviceAddressId: site.id, status: "ACTIVE" },
    select: { lines: { select: { assignments: {
      where: { unassignedAt: null },
      select: { appliance: {
        select: { id: true, assetNumber: true, applianceType: { select: { name: true } } },
      } },
    } } } },
  });
  const appliances = agreements.flatMap(a => a.lines.flatMap(l =>
    l.assignments.map(x => ({
      id: x.appliance.id,
      label: x.appliance.applianceType.name + " · " + x.appliance.assetNumber,
    }))));
  return { location: [site.unitLabel, site.line1, site.city].filter(Boolean).join(" · "),
    appliances: [...new Map(appliances.map(a => [a.id, a])).values()] };
}
export async function submitTenantRepair(token: string, input: { applianceId: string; problem: string }) {
  const hash = repairHash(token);
  if (!hash) throw new Error("This repair link is invalid.");
  const problem = z.string().trim().min(10).max(2000).parse(input.problem);
  const applianceId = z.string().min(1).max(100).parse(input.applianceId);
  // Transactions + token consumption eliminate replay/double reports. Any denial rolls back.
  return prisma.$transaction(async tx => {
    const person = await tx.locationContact.findFirst({
      where: { repairTokenHash: hash, repairTokenExpiresAt: { gt: new Date() },
        endedAt: null, erasedAt: null,
        OR: [{ startedAt: null }, { startedAt: { lte: new Date() } }] },
      select: { id: true, serviceAddressId: true, serviceAddress: {
        select: { customerId: true, locationContactPolicy: true,
          customer: { select: { archivedAt: true, locationContactPolicy: true } } },
      } },
    });
    const site = person?.serviceAddress;
    if (!person || !site || site.customer.archivedAt ||
      !effectiveLocationPermission(site.customer.locationContactPolicy, site.locationContactPolicy).maintenance)
      throw new Error("This repair link is no longer active.");
    const activeRental = await tx.rentalAgreement.findFirst({
      where: { customerId: site.customerId, serviceAddressId: person.serviceAddressId,
        status: "ACTIVE", lines: { some: { assignments: {
          some: { applianceId, unassignedAt: null },
        } } } },
      select: { id: true },
    });
    if (!activeRental) throw new Error("Choose a machine on this location's active rental.");
    const consumed = await tx.locationContact.updateMany({
      where: { id: person.id, repairTokenHash: hash, repairTokenExpiresAt: { gt: new Date() },
        endedAt: null, erasedAt: null,
        OR: [{ startedAt: null }, { startedAt: { lte: new Date() } }] },
      data: { repairTokenHash: null, repairTokenExpiresAt: null },
    });
    if (consumed.count !== 1) throw new Error("This repair link was already used.");
    const request = await tx.maintenanceRequest.create({
      data: { customerId: site.customerId, serviceAddressId: person.serviceAddressId,
        applianceId, problem, priority: "NORMAL" },
    });
    // Customer notice persists regardless of outbound-email activation. No direct billing,
    // charge, tenant login, tenant SMS, scheduled visit or provider write.
    await tx.customerNotice.create({ data: {
      customerId: site.customerId, kind: "TENANT_REPAIR",
      dedupeKey: "tenant-repair:" + request.id,
      subject: "New repair report from a tenant",
      body: "A tenant has reported a repair at one of your properties. Review the request in your customer portal. Any chargeable damage needs your independent approval.",
    } });
    await tx.auditLog.create({ data: {
      action: "location.tenant_repair.request", entityType: "MaintenanceRequest",
      entityId: request.id, newValue: {
        contactId: person.id, serviceAddressId: person.serviceAddressId, customerId: site.customerId,
      },
    } });
    return request.id;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
