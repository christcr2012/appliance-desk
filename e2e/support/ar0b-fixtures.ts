import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";

// AR-0b browser specs: one throwaway customer with one long-overdue bill (local bill, so it is paid by "Record cash or
// check"), created straight in the disposable test database and removed afterwards.
export const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
export const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/appliance_desk_test";
export const SIZES = [360, 390, 820, 1280, 1920] as const;

/** Elements whose right edge is past the window (to explain a sideways-scroll failure). */
export async function overflowReport(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify({
      width: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      dark: document.documentElement.classList.contains("dark"),
      overflowing: [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 0.5)
        .slice(0, 12)
        .map((el) => {
          const style = getComputedStyle(el);
          return `${el.tagName}.${String(el.className).slice(0, 80)} pos=${style.position} right=${Math.round(el.getBoundingClientRect().right)} text=${(el.textContent ?? "").slice(0, 40)}`;
        }),
    }),
  );
}

/** The shared five-size scan, adding the overflowing elements to the message when it fails. */
export async function scanWithReport(page: Page, scan: () => Promise<void>) {
  try {
    await scan();
  } catch (error) {
    const report = await overflowReport(page).catch(() => "unavailable");
    throw new Error(`${error instanceof Error ? error.message.slice(0, 300) : String(error)}\nLayout: ${report}`);
  }
}

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
