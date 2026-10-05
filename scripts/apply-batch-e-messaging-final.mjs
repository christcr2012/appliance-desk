import fs from "node:fs";

function replaceOnce(text, from, to, label) {
  const first = text.indexOf(from);
  if (first < 0) throw new Error(`Missing ${label} marker`);
  if (text.indexOf(from, first + 1) >= 0) throw new Error(`Non-unique ${label} marker`);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

{
  const path = "docs/ARCHITECTURE.md";
  let text = fs.readFileSync(path, "utf8");
  const marker = "- `RESEND_API_KEY` — **set**, a sending-only key created via the Resend MCP connector for the now-verified `robinsonappliancerentals.com` domain.\n";
  text = replaceOnce(
    text,
    marker,
    marker +
      "- `RESEND_WEBHOOK_SECRET` — signing secret for `/api/webhooks/resend`; the route fails closed when absent and verifies the raw body plus Svix headers before storing or processing any provider event.\n" +
      "- Twilio callbacks at `/api/webhooks/twilio` reuse `TWILIO_AUTH_TOKEN` for `X-Twilio-Signature` validation against the exact callback URL and submitted form parameters; missing credentials fail closed.\n",
    "architecture Resend env",
  );
  fs.writeFileSync(path, text);
}

{
  const path = "tests/notices-state-integration.test.ts";
  let text = fs.readFileSync(path, "utf8");
  const from = `      const calls = emailMock.send.mock.calls.map((c) => c[0]).filter((c) => c.idempotencyKey === \`customer-notice-\${notice.id}\`);\n      expect(calls).toHaveLength(1);\n      expect(calls[0].to).toBe(frozen);\n      const after = await prisma.customerNotice.findUniqueOrThrow({ where: { id: notice.id } });\n      expect(after.status).toBe("SENT");\n      expect(after.providerMessageId).toBe("msg_a");\n`;
  const to = `      const calls = emailMock.send.mock.calls.map((c) => c[0]).filter((c) => c.idempotencyKey === \`customer-notice-\${notice.id}\`);\n      // MessageDelivery already durably recorded provider acceptance. Recovery repairs the legal-evidence row without contacting the provider again.\n      expect(calls).toHaveLength(0);\n      const after = await prisma.customerNotice.findUniqueOrThrow({ where: { id: notice.id } });\n      expect(after.status).toBe("SENT");\n      expect(after.providerMessageId).toBe("msg_a");\n      expect(after.sentToAddress).toBe(frozen);\n`;
  text = replaceOnce(text, from, to, "notice ledger recovery assertion");
  fs.writeFileSync(path, text);
}
