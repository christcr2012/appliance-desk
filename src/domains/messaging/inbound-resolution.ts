export type InboundBindingCandidate = {
  verifiedAt: Date | null; revokedAt: Date | null;
  customerId: string | null; leadId: string | null;
  customerContact: { customerId: string } | null;
};
export type InboundIdentity = {
  resolution: "RESOLVED" | "AMBIGUOUS" | "UNRESOLVED";
  customerId: string | null; leadId: string | null;
};

/** A phone number is not authentication or a business record association. */
export function resolveInboundContact(rows: readonly InboundBindingCandidate[]): InboundIdentity {
  const people = new Set<string>();
  for (const row of rows) {
    if (!row.verifiedAt || row.revokedAt) continue;
    const subjectCount = Number(Boolean(row.customerId)) + Number(Boolean(row.leadId)) +
      Number(Boolean(row.customerContact));
    if (subjectCount !== 1) return { resolution: "AMBIGUOUS", customerId: null, leadId: null };
    if (row.customerId) people.add("customer:" + row.customerId);
    else if (row.leadId) people.add("lead:" + row.leadId);
    else if (row.customerContact) people.add("customer:" + row.customerContact.customerId);
  }
  if (people.size > 1) return { resolution: "AMBIGUOUS", customerId: null, leadId: null };
  const identity = people.values().next().value as string | undefined;
  if (!identity) return { resolution: "UNRESOLVED", customerId: null, leadId: null };
  return identity.startsWith("customer:")
    ? { resolution: "RESOLVED", customerId: identity.slice(9), leadId: null }
    : { resolution: "RESOLVED", customerId: null, leadId: identity.slice(5) };
}

/** A reassigned/shared number cannot automatically transfer old message history. */
export function safeExistingThreadIdentity(
  current: { resolution: string; customerId: string | null; leadId: string | null },
  proposed: InboundIdentity,
): InboundIdentity {
  const prior = current.customerId ? "customer:" + current.customerId :
    current.leadId ? "lead:" + current.leadId : null;
  const next = proposed.customerId ? "customer:" + proposed.customerId :
    proposed.leadId ? "lead:" + proposed.leadId : null;
  // Once any thread becomes ambiguous, it needs explicit staff review to
  // reclaim a principal. The same number might be shared or reassigned.
  if (current.resolution === "AMBIGUOUS" ||
      (current.resolution === "RESOLVED" && (!prior || next !== prior))) {
    return { resolution: "AMBIGUOUS", customerId: null, leadId: null };
  }
  return proposed;
}
