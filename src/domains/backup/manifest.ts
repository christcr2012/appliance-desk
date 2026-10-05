import type { Prisma, PrismaClient } from "@prisma/client";

// Require an explicit backup policy for every generated Prisma model.
// A new model without a decision fails typecheck instead of silently disappearing.
type ModelDelegate = {
  [K in keyof PrismaClient]: PrismaClient[K] extends { findMany: unknown } ? K : never;
}[keyof PrismaClient];

// Sessions and verification tokens are ephemeral. Account credentials and
// webhook idempotency records retain their existing exclusions; credential
// recovery and safe webhook replay need separate recovery procedures.
export const BACKUP_MODEL_POLICY = {
  User: "user",
  Session: null,
  Account: null,
  Verification: null,
  Customer: "customer",
  Referral: "referral",
  ServiceAddress: "serviceAddress",
  Lead: "lead",
  LeadNote: "leadNote",
  LeadApplianceRequest: "leadApplianceRequest",
  ApplianceType: "applianceType",
  Appliance: "appliance",
  ApplianceInspection: "applianceInspection",
  PartRecord: "partRecord",
  Supplier: "supplier",
  PurchaseOrder: "purchaseOrder",
  PurchaseOrderLineItem: "purchaseOrderLineItem",
  PurchaseOrderReceiptOperation: "purchaseOrderReceiptOperation",
  PartStockMovement: "partStockMovement",
  ApplianceCustodyEpisode: "applianceCustodyEpisode",
  RentalLineAmendment: "rentalLineAmendment",
  InspectionChecklistVersion: "inspectionChecklistVersion",
  ApplianceInspectionAmendment: "applianceInspectionAmendment",
  JobBillingHandoff: "jobBillingHandoff",
  RentalAgreement: "rentalAgreement",
  RentalLine: "rentalLine",
  ApplianceAssignment: "applianceAssignment",
  PricingRule: "pricingRule",
  SignatureRecord: "signatureRecord",
  Deposit: "deposit",
  Job: "job",
  JobAppliance: "jobAppliance",
  PendingDelivery: "pendingDelivery",
  MaintenanceRequest: "maintenanceRequest",
  Estimate: "estimate",
  EstimateLineItem: "estimateLineItem",
  Invoice: "invoice",
  InvoiceLineItem: "invoiceLineItem",
  Payment: "payment",
  Refund: "refund",
  CustomerCredit: "customerCredit",
  ProviderOperation: "providerOperation",
  Receipt: "receipt",
  CreditApplication: "creditApplication",
  WebhookEvent: null,
  BusinessSettings: "businessSettings",
  SiteContent: "siteContent",
  Photo: "photo",
  ConsentRecord: "consentRecord",
  CustomerNotice: "customerNotice",
  CustomerNote: "customerNote",
  CustomerContact: "customerContact",
  StaffTask: "staffTask",
  AuditLog: "auditLog",
  LaunchSettings: "launchSettings",
  LaunchSubscriber: "launchSubscriber",
  LaunchDelivery: "launchDelivery",
  AssetNumberCounter: "assetNumberCounter",
} satisfies Record<Prisma.ModelName, ModelDelegate | null>;

export const BACKUP_TABLES = Object.values(BACKUP_MODEL_POLICY).filter(
  (table) => table !== null,
);
