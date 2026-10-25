import { randomUUID } from "node:crypto";

// AR-0b browser specs: one throwaway customer with one long-overdue bill (local bill, so it is paid by "Record cash or
// check"), created straight in the disposable test database and removed afterwards.
export const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
export const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/appliance_desk_test";
export const SIZES = [360, 390, 820, 1280, 1920] as const;

export async function overdueCustomer(label: string) {
  const { prisma } = await import("../../src/lib/prisma");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const name = `${label} ${tag}`;
  const userId = `ar0b-u-${tag}`;
  const customerId = `ar0b-c-${tag}`;
  await prisma.user.create({ data: { id: userId, email: `ar0b-${tag}@example.test`, name, role: "CUSTOMER" } });
  await prisma.customer.create({ data: { id: customerId, userId, referralCode: `AR0B${tag}`, phone: "970-555-0142" } });
  await prisma.serviceAddress.create({ data: { customerId, line1: "1402 10th Ave", city: "Greeley", zip: "80631" } });
  // Due long ago so it sorts first among past-due To do items and past-due bills.
  const bill = await prisma.invoice.create({
    data: { customerId, status: "OPEN", dueDate: new Date(Date.now() - 9000 * 86_400_000), amountDueCents: 7000 },
  });
  return {
    name,
    customerId,
    billId: bill.id,
    billNumber: bill.invoiceNumber,
    async cleanup() {
      await prisma.exceptionSnooze.deleteMany({ where: { href: { contains: customerId } } });
      await prisma.invoice.deleteMany({ where: { customerId } });
      await prisma.serviceAddress.deleteMany({ where: { customerId } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    },
  };
}
