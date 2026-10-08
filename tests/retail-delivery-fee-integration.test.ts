import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { recordRentalDeliveryFeeInTx } from "@/domains/tax/rdf-records";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";
const day = (s: string) => businessDateFromKey(s)!;
class FixtureRollback extends Error {}

type Fixture = {
  tx: Prisma.TransactionClient;
  agreementId: string;
  jobId: string;
  addressId: string;
  stateId: string;
  ownerId: string;
  customerId: string;
  deliveredOn: Date;
  addInvoice: (issuedAt: Date, paidAt?: Date) => Promise<void>;
  addRate: (effectiveOn: Date, cents: number) => Promise<void>;
  createJob: (type: "DELIVERY" | "SWAP" | "INSTALLATION") => Promise<string>;
  setLocation: () => Promise<void>;
};
async function runIsolated(
  run: (fixture: Fixture) => Promise<void>,
  options: { prepaid?: boolean; verified?: boolean; applicable?: boolean } = {},
) {
  try {
    await prisma.$transaction(
      async (tx) => {
        const token = randomUUID().replaceAll("-", "");
        const ownerId = "rdf2-owner-" + token;
        const customerId = "rdf2-customer-" + token;
        const addressId = "rdf2-address-" + token;
        const agreementId = "rdf2-agreement-" + token;
        const stateId = "rdf2-state-" + token;
        const deliveredOn = day("2026-08-03");
        await tx.user.create({
          data: {
            id: ownerId,
            email: token + "@rdf.example.test",
            role: "OWNER",
            name: "RDF test",
            passwordHash: "test-only",
          },
        });
        await tx.customer.create({
          data: {
            id: customerId,
            userId: ownerId,
            referralCode: "RDF2" + token.slice(0, 12),
          },
        });
        await tx.serviceAddress.create({
          data: {
            id: addressId,
            customerId,
            line1: "1 Fixture Rd",
            city: "Greeley",
            zip: "80631",
            state: "CO",
          },
        });
        await tx.rentalAgreement.create({
          data: {
            id: agreementId,
            customerId,
            serviceAddressId: addressId,
            status: "ACTIVE",
            paidInFullInAdvance: options.prepaid ?? false,
            lines: {
              create: {
                label: "Washer",
                monthlyPriceCents: 4000,
                listPriceCents: 4000,
              },
            },
          },
        });
        await tx.businessSettings.update({
          where: { id: "singleton" },
          data: {
            shortTermLeaseElection: "COLLECT_ON_RENTALS",
            rdfThresholdCents: options.applicable ? 1 : 50000000,
            rdfThresholdCrossedOn: null,
            rdfHandling: "PAY_MYSELF",
            rdfCpaConfirmedOn: day("2026-01-01"),
          },
        });
        const account = await tx.taxFilingAccount.create({
          data: {
            name: "Colorado RDF test " + token,
            kind: "SALES_RETURN",
            frequency: "MONTHLY",
          },
        });
        await tx.taxJurisdiction.create({
          data: {
            id: stateId,
            code: "RDF2-" + token,
            name: "Colorado test state",
            level: "STATE",
            administration: "STATE_COLLECTED",
            filingAccountId: account.id,
            reviewStatus: "REVIEWED",
          },
        });
        const setLocation = async () => {
          await tx.addressTaxLocation.create({
            data: {
              serviceAddressId: addressId,
              status: "VERIFIED",
              source: "MANUAL",
              lookedUpAt: deliveredOn,
              isCurrent: true,
              jurisdictions: { create: { jurisdictionId: stateId } },
            },
          });
        };
        if (options.verified !== false) await setLocation();
        const type = await tx.applianceType.create({
          data: { name: "RDF washer " + token, slug: "rdf-washer-" + token },
        });
        const appliance = await tx.appliance.create({
          data: {
            assetNumber: "RDF2-" + token,
            applianceTypeId: type.id,
            status: "RENTED",
          },
        });
        let index = 0;
        const createJob = async (
          jobType: "DELIVERY" | "SWAP" | "INSTALLATION",
        ) => {
          const id = "rdf2-job-" + index++ + "-" + token;
          await tx.job.create({
            data: {
              id,
              type: jobType,
              status: "COMPLETED",
              agreementId,
              customerId,
              serviceAddressId: addressId,
              completedAt: deliveredOn,
              appliances: {
                create: { applianceId: appliance.id, result: "DELIVERED" },
              },
            },
          });
          return id;
        };
        const jobId = await createJob("DELIVERY");
        const addInvoice = async (issuedAt: Date, paidAt?: Date) => {
          const invoice = await tx.invoice.create({
            data: {
              customerId,
              agreementId,
              status: paidAt ? "PAID" : "OPEN",
              amountDueCents: 4000,
              amountPaidCents: paidAt ? 4000 : 0,
              issuedAt,
              lineItems: {
                create: {
                  kind: "RENTAL",
                  description: "First rent",
                  amountCents: 4000,
                },
              },
            },
          });
          if (paidAt) {
            const receipt = await tx.receipt.create({
              data: {
                customerId, source: "MANUAL", amountCents: 4000,
                method: "test", receivedOn: paidAt,
              },
            });
            await tx.payment.create({
              data: {
                invoiceId: invoice.id, receiptId: receipt.id,
                amountCents: 4000, status: "succeeded",
                // Webhook/entry arrives AFTER the payment. This must not
                // determine the legal RDF rate date.
                createdAt: day("2026-08-04"),
              },
            });
          }
        };
        const addRate = async (effectiveOn: Date, cents: number) => {
          await tx.retailDeliveryFeeRate.create({
            data: { effectiveOn, amountCents: cents, enteredByUserId: ownerId },
          });
        };
        if (options.applicable) {
          // Prior-year Colorado retail sales belong to a different sale.
          // They establish business-level RDF applicability, not the tested rental's sale date.
          const earlierAgreementId = "rdf2-earlier-" + token;
          await tx.rentalAgreement.create({
            data: {
              id: earlierAgreementId,
              customerId,
              serviceAddressId: addressId,
              status: "ACTIVE",
            },
          });
          await tx.invoice.create({
            data: {
              customerId,
              agreementId: earlierAgreementId,
              status: "OPEN",
              amountDueCents: 4000,
              issuedAt: day("2025-12-02"),
              lineItems: {
                create: {
                  kind: "RENTAL",
                  description: "Prior-year retail sale",
                  amountCents: 4000,
                },
              },
            },
          });
        }
        await run({
          tx,
          agreementId,
          jobId,
          addressId,
          stateId,
          customerId,
          ownerId,
          deliveredOn,
          addInvoice,
          addRate,
          createJob,
          setLocation,
        });
        // Rolling back the whole fixture preserves other tests and any shared test
        // settings, while assertions above still query real persisted Postgres rows.
        throw new FixtureRollback();
      },
      { timeout: 30000 },
    );
  } catch (error) {
    if (!(error instanceof FixtureRollback)) throw error;
  }
}

describe.skipIf(!enabled)(
  "T-6C2 rental delivery fee records (real PostgreSQL)",
  () => {
    it("completion retry once per sale; stored record and audit remain singular", async () => {
      await runIsolated(async (f) => {
        const input = {
          jobId: f.jobId,
          agreementId: f.agreementId,
          saleKey: "agreement:" + f.agreementId,
          deliveredOn: f.deliveredOn,
        };
        const first = await recordRentalDeliveryFeeInTx(f.tx, input);
        const replay = await recordRentalDeliveryFeeInTx(f.tx, input);
        expect(replay).toEqual(first);
        expect(first.status).toBe("NOT_DUE");
        expect(
          await f.tx.retailDeliveryFeeRecord.count({
            where: { agreementId: f.agreementId },
          }),
        ).toBe(1);
        expect(
          await f.tx.auditLog.count({
            where: {
              entityType: "RetailDeliveryFeeRecord",
              entityId: first.recordId!,
            },
          }),
        ).toBe(1);
      });
    });
    it("partial delivery dedupes later delivery trips for the same agreement sale", async () => {
      await runIsolated(async (f) => {
        const first = await recordRentalDeliveryFeeInTx(f.tx, {
          jobId: f.jobId,
          agreementId: f.agreementId,
          saleKey: "agreement:" + f.agreementId,
          deliveredOn: f.deliveredOn,
        });
        const later = await f.createJob("DELIVERY");
        const second = await recordRentalDeliveryFeeInTx(f.tx, {
          jobId: later,
          agreementId: f.agreementId,
          saleKey: "agreement:" + f.agreementId,
          deliveredOn: day("2026-08-07"),
        });
        expect(second.recordId).toBe(first.recordId);
        expect(
          await f.tx.retailDeliveryFeeRecord.count({
            where: { agreementId: f.agreementId },
          }),
        ).toBe(1);
        const saved = await f.tx.retailDeliveryFeeRecord.findUniqueOrThrow({
          where: { id: first.recordId! },
        });
        expect(saved.firstJobId).toBe(f.jobId);
        expect(businessDateKey(saved.deliveredOn)).toBe("2026-08-03");
      });
    });
    it("free replacement excluded and arbitrary sale keys rejected", async () => {
      await runIsolated(async (f) => {
        const swap = await f.createJob("SWAP");
        expect(
          await recordRentalDeliveryFeeInTx(f.tx, {
            jobId: swap,
            agreementId: f.agreementId,
            saleKey: "agreement:" + f.agreementId,
            deliveredOn: f.deliveredOn,
          }),
        ).toEqual({ recordId: null, status: null });
        await expect(
          recordRentalDeliveryFeeInTx(f.tx, {
            jobId: f.jobId,
            agreementId: f.agreementId,
            saleKey: "addition:forged",
            deliveredOn: f.deliveredOn,
          }),
        ).rejects.toThrow(/identity/);
        expect(
          await f.tx.retailDeliveryFeeRecord.count({
            where: { agreementId: f.agreementId },
          }),
        ).toBe(0);
      });
    });
    it("missing rate retains sale evidence and leaves billing untouched", async () => {
      await runIsolated(
        async (f) => {
          await f.addInvoice(day("2026-07-20"));
          const result = await recordRentalDeliveryFeeInTx(f.tx, {
            jobId: f.jobId,
            agreementId: f.agreementId,
            saleKey: "agreement:" + f.agreementId,
            deliveredOn: f.deliveredOn,
          });
          const row = await f.tx.retailDeliveryFeeRecord.findUniqueOrThrow({
            where: { id: result.recordId! },
          });
          expect(row.status).toBe("PENDING_RATE");
          expect(businessDateKey(row.saleOn!)).toBe("2026-07-20");
          expect(row.amountCents).toBeNull();
          expect(row.invoiceLineId).toBeNull();
        },
        { applicable: true },
      );
    });
    it("prepaid June invoice paid July uses July amount, not June or delivery rate", async () => {
      await runIsolated(
        async (f) => {
          await f.addRate(day("2026-06-01"), 30);
          await f.addRate(day("2026-07-01"), 41);
          await f.addInvoice(day("2026-06-28"), day("2026-07-07"));
          const result = await recordRentalDeliveryFeeInTx(f.tx, {
            jobId: f.jobId,
            agreementId: f.agreementId,
            saleKey: "agreement:" + f.agreementId,
            deliveredOn: f.deliveredOn,
          });
          const row = await f.tx.retailDeliveryFeeRecord.findUniqueOrThrow({
            where: { id: result.recordId! },
          });
          expect(row.status).toBe("READY");
          expect(row.amountCents).toBe(41);
          expect(businessDateKey(row.saleOn!)).toBe("2026-07-07");
          expect(businessDateKey(row.deliveredOn)).toBe("2026-08-03");
          expect(row.collectedFromCustomer).toBe(false);
        },
        { prepaid: true, applicable: true },
      );
    });
    it("sale date and delivery date differ; verified location repairs pending decision", async () => {
      await runIsolated(
        async (f) => {
          await f.addRate(day("2026-07-01"), 41);
          await f.addRate(day("2026-08-01"), 46);
          await f.addInvoice(day("2026-07-20"));
          const input = {
            jobId: f.jobId,
            agreementId: f.agreementId,
            saleKey: "agreement:" + f.agreementId,
            deliveredOn: f.deliveredOn,
          };
          const before = await recordRentalDeliveryFeeInTx(f.tx, input);
          expect(before.status).toBe("PENDING_DECISION");
          await f.setLocation();
          const after = await recordRentalDeliveryFeeInTx(f.tx, input);
          expect(after.recordId).toBe(before.recordId);
          const row = await f.tx.retailDeliveryFeeRecord.findUniqueOrThrow({
            where: { id: after.recordId! },
          });
          expect(row.status).toBe("READY");
          expect(row.amountCents).toBe(41);
          expect(businessDateKey(row.deliveredOn)).toBe("2026-08-03");
          expect(businessDateKey(row.saleOn!)).toBe("2026-07-20");
          expect(
            await f.tx.auditLog.count({
              where: {
                entityType: "RetailDeliveryFeeRecord",
                entityId: row.id,
              },
            }),
          ).toBe(2);
        },
        { verified: false, applicable: true },
      );
    });
  },
);
