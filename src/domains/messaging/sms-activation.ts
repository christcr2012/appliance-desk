import { prisma } from "@/lib/prisma";

/** Outer gate for customer SMS, independent of email and provider credentials. */
export async function isLegacySmsDispatchEnabled(): Promise<boolean> {
  try {
    const settings = await prisma.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { customerSmsEnabled: true },
    });
    return settings?.customerSmsEnabled === true;
  } catch {
    // An unreadable owner switch is never implied permission to transmit.
    console.error("[sms] SMS activation unavailable; sending disabled");
    return false;
  }
}
