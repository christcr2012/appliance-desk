import fs from "node:fs";

const path = "src/domains/estimates/index-base.ts";
let text = fs.readFileSync(path, "utf8");

function once(from, to) {
  const first = text.indexOf(from);
  if (first < 0) throw new Error(`Missing transform marker: ${from.slice(0, 80)}`);
  if (text.indexOf(from, first + 1) >= 0) throw new Error(`Non-unique transform marker: ${from.slice(0, 80)}`);
  text = text.slice(0, first) + to + text.slice(first + from.length);
}

function section(start, end, replacement) {
  const a = text.indexOf(start);
  if (a < 0) throw new Error(`Missing start marker: ${start}`);
  const b = text.indexOf(end, a);
  if (b < 0) throw new Error(`Missing end marker: ${end}`);
  const stop = b + end.length;
  text = text.slice(0, a) + replacement + text.slice(stop);
}

once(
  'import { sendCustomerEmail } from "@/lib/customer-email";',
  'import { deliverMessage } from "@/domains/messaging/deliver";',
);

section(
  '  const result = await sendCustomerEmail({\n',
  '  return { emailed: result.sent, outcome: result.outcome };\n',
  `  const delivery = await deliverMessage({
    idempotencyKey: \`estimate-send-\${estimate.id}-\${sentAt.getTime()}\`,
    channel: "EMAIL",
    purpose: "TRANSACTIONAL",
    templateKey: "estimate-send",
    customerFacing: true,
    recipient: {
      type: estimate.customer ? "Customer" : "Lead",
      address: recipientEmail,
    },
    subject: { type: "Estimate", id: estimate.id },
    render: () => ({
      subject: \`Estimate #\${estimate.estimateNumber} from \${settings.publicBusinessName}\`,
      text: parts.join("\\n\\n"),
      actionLabel: "View & respond to estimate",
    }),
  });
  const emailed = delivery.state === "ACCEPTED" || delivery.state === "DELIVERED";
  const outcome = emailed
    ? "SENT"
    : delivery.state === "NOT_SENT"
      ? "NOT_ATTEMPTED"
      : delivery.state === "FAILED"
        ? "REJECTED"
        : delivery.state;
  if (!emailed && outcome !== "NOT_ATTEMPTED") {
    await prisma.auditLog.create({
      data: {
        userId,
        action: "estimate.send_email_unconfirmed",
        entityType: "Estimate",
        entityId: estimate.id,
        newValue: { outcome, deliveryId: delivery.deliveryId, sentAt: sentAt.toISOString() },
      },
    });
  }
  return { emailed, outcome };
`,
);

const followStart = '      const result = await sendCustomerEmail({\n';
const followEnd = '      if (result.sent) sent += 1;\n';
section(
  followStart,
  followEnd,
  `      const delivery = await deliverMessage({
        idempotencyKey: \`estimate-follow-up-\${estimate.id}-\${estimate.sentAt.getTime()}\`,
        channel: "EMAIL",
        purpose: "TRANSACTIONAL",
        templateKey: "estimate-follow-up",
        customerFacing: true,
        recipient: {
          type: estimate.customer ? "Customer" : "Lead",
          address: recipientEmail,
        },
        subject: { type: "Estimate", id: estimate.id },
        render: () => ({
          subject: \`Following up on estimate #\${estimate.estimateNumber}\`,
          text: [
            \`Hi\${recipientName ? \` \${recipientName}\` : ""},\`,
            \`Just checking in — \${settings.publicBusinessName} sent you estimate #\${estimate.estimateNumber}\${estimate.title ? \` (\${estimate.title})\` : ""} a few days ago and wanted to make sure it didn't get lost.\`,
            "Still interested? You can review and respond right here — no login needed:",
            \`\${appUrl}/estimate/\${estimate.id}\`,
            "If your plans have changed or you have questions, just reply to this email.",
          ].join("\\n\\n"),
          actionLabel: "View & respond to estimate",
        }),
      });
      if (delivery.state === "FAILED" || delivery.state === "NOT_SENT") {
        await release();
        if (delivery.state === "FAILED") failed += 1;
        continue;
      }
      if (delivery.state === "ACCEPTED" || delivery.state === "DELIVERED") sent += 1;
      else if (delivery.state === "UNKNOWN") failed += 1;
`,
);

fs.writeFileSync(path, text);
// This branch-only transform is intentionally self-deleting in its workflow.
