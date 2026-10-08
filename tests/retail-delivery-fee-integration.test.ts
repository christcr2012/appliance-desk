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
        const addressId = "rdf2-address-" + toke¶»§q«^