import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue({ sent: false }),
}));
import { prisma } from "@/lib/prisma";
import { createLead } from "@/domains/leads";
import { leadFormSchemaForCatalog } from "@/domains/leads/schema";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";
describe.skipIf(!enabled)(
  "general enquiry persistence in disposable CI Postgres",
  () => {
    let leadId: string | undefined;
    afterAll(async () => {
      if (!leadId) return;
      await prisma.consentRecord.deleteMany({
        where: { details: { path: ["leadId"], equals: leadId } },
      });
      await prisma.lead.delete({ where: { id: leadId } });
    });
    it("commits a real lead and privacy consent without inventing an appliance request", async () => {
      const input = leadFormSchemaForCatalog(false).parse({
        accountType: "individual",
        isPropertyManager: false,
        contactName: "CI general enquiry",
        phone: "5551234567",
        applianceTypeIds: [],
        quantity: 1,
        desiredTerm: "month-to-month",
        notes: "Please call about a washer",
        consent: true,
      });
      const lead = await createLead(input);
      leadId = lead.id;
      const persisted = await prisma.lead.findUniqueOrThrow({
        where: { id: leadId },
        include: { applianceRequests: true },
      });
      expect(persisted).toMatchObject({
        contactName: input.contactName,
        notes: input.notes,
        applianceRequests: [],
      });
      expect(persisted.consentedAt).toBeInstanceOf(Date);
      expect(
        await prisma.consentRecord.count({
          where: {
            kind: "lead_form_privacy",
            details: { path: ["leadId"], equals: leadId },
          },
        }),
      ).toBe(1);
    });
  },
);
