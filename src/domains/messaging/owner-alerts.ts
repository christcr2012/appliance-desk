import { deliverMessage } from "@/domains/messaging/deliver";
import { prisma } from "@/lib/prisma";

/** An owner-only transactional notice: the logical key is scoped to EACH active owner's login. */
export async function sendOwnerAlert(input: {
  key: string;
  subject: string;
  text: string;
  href: string;
}): Promise<void> {
  if (!input.key.trim() || !input.href.startsWith("/desk/")) {
    throw new Error("Owner alert requires a stable key and an internal Desk link.");
  }
  const owners = await prisma.user.findMany({
    where: { role: "OWNER", archivedAt: null },
    select: { id: true, email: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  // No fallback to a public/business email: only active Owner logins get internal alerts.
  if (!owners.length) throw new Error("There is no active owner to receive the alert.");
  for (const owner of owners) {
    await deliverMessage({
      idempotencyKey: `${input.key}:owner:${owner.id}`,
      channel: "EMAIL",
      purpose: "TRANSACTIONAL",
      templateKey: "owner-alert",
      customerFacing: false,
      recipient: { type: "User", id: owner.id, address: owner.email },
      subject: { type: "User", id: owner.id },
      render: () => ({
        subject: input.subject,
        text: `${input.text}\n\nOpen Appliance Desk: ${input.href}`,
      }),
    });
  }
}
