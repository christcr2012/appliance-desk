import { describe, expect, it } from "vitest";
import {
  resolveInboundContact, safeExistingThreadIdentity,
  type InboundBindingCandidate,
} from "@/domains/messaging/inbound-resolution";

const confirmed = (data: Partial<InboundBindingCandidate>): InboundBindingCandidate => ({
  verifiedAt: new Date("2026-10-09T15:00:00Z"),
  revokedAt: null, customerId: null, leadId: null,
  customerContact: null, ...data,
});

describe("COM-L5A inbound identity is strictly evidence-based", () => {
  it("leaves unknown and unverified numbers unresolved", () => {
    expect(resolveInboundContact([])).toEqual({
      resolution: "UNRESOLVED", customerId: null, leadId: null,
    });
    expect(resolveInboundContact([confirmed({
      customerId: "customer-1", verifiedAt: null,
    })])).toMatchObject({ resolution: "UNRESOLVED" });
    expect(resolveInboundContact([confirmed({
      customerId: "customer-1", revokedAt: new Date(),
    })])).toMatchObject({ resolution: "UNRESOLVED" });
  });
  it("resolves only one unique verified person, not properties or jobs", () => {
    expect(resolveInboundContact([confirmed({
      customerId: "customer-1",
    })])).toEqual({ resolution: "RESOLVED", customerId: "customer-1", leadId: null });
    expect(resolveInboundContact([confirmed({
      customerContact: { customerId: "customer-1" },
    }), confirmed({ customerId: "customer-1" })])).toEqual({
      resolution: "RESOLVED", customerId: "customer-1", leadId: null,
    });
    expect(resolveInboundContact([confirmed({
      leadId: "lead-1",
    })])).toEqual({ resolution: "RESOLVED", customerId: null, leadId: "lead-1" });
  });
  it("keeps shared and improperly multi-subject identities ambiguous", () => {
    expect(resolveInboundContact([
      confirmed({ customerId: "customer-1" }),
      confirmed({ customerId: "customer-2" }),
    ])).toEqual({ resolution: "AMBIGUOUS", customerId: null, leadId: null });
    expect(resolveInboundContact([confirmed({
      customerId: "customer-1", leadId: "lead-1",
    })])).toMatchObject({ resolution: "AMBIGUOUS" });
  });
  it("never moves historical conversation to a reassigned number's new owner", () => {
    expect(safeExistingThreadIdentity({
      resolution: "RESOLVED", customerId: "old", leadId: null,
    }, { resolution: "RESOLVED", customerId: "new", leadId: null }))
      .toEqual({ resolution: "AMBIGUOUS", customerId: null, leadId: null });
    expect(safeExistingThreadIdentity({
      resolution: "RESOLVED", customerId: "old", leadId: null,
    }, { resolution: "UNRESOLVED", customerId: null, leadId: null }))
      .toMatchObject({ resolution: "AMBIGUOUS" });
    expect(safeExistingThreadIdentity({
      resolution: "AMBIGUOUS", customerId: null, leadId: null,
    }, { resolution: "RESOLVED", customerId: "new", leadId: null }))
      .toEqual({ resolution: "AMBIGUOUS", customerId: null, leadId: null });
  });
});
