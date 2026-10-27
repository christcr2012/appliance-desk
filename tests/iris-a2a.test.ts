import { describe, expect, it } from "vitest";
import {
  buildA2aPayload,
  irisA2aStatus,
  parseA2aResponse,
  submitInformationReturn,
  type A2aSubmission,
} from "@/domains/compliance/iris-a2a";

// CMP-3: the IRIS A2A client stays OFF until the owner has an A2A TCC,
// a client id and the endpoint (checklist items), and its request and
// response handling is pinned against Pub 5718-shaped fixtures with no
// network involved.

const submission: A2aSubmission = {
  formType: "1099-NEC",
  taxYear: 2026,
  payer: { tinType: "EIN", tinDigits: "123456789", name: "Robinson Appliance Rentals LLC", country: "US" },
  recipient: { tinType: "EIN", tinDigits: "987654321", name: "Sample Services LLC", country: "US" },
  amountsCents: { box1: 250000 },
};

const ON_ENV = {
  IRIS_A2A_ENABLED: "true",
  IRIS_A2A_TCC: "TESTTCC",
  IRIS_A2A_CLIENT_ID: "test-client",
  IRIS_A2A_ENDPOINT: "https://example.invalid/iris",
} as unknown as NodeJS.ProcessEnv;

describe("iris a2a client", () => {
  it("is off by default and says why", () => {
    const status = irisA2aStatus({} as NodeJS.ProcessEnv);
    expect(status.enabled).toBe(false);
    expect(status.reason).toMatch(/switched off/);
  });

  it("is off when switched on but the TCC or client id is missing", () => {
    const status = irisA2aStatus({ IRIS_A2A_ENABLED: "true" } as unknown as NodeJS.ProcessEnv);
    expect(status.enabled).toBe(false);
    expect(status.reason).toMatch(/missing/);
  });

  it("refuses to submit while off, without touching the transport", async () => {
    let called = false;
    await expect(
      submitInformationReturn(
        submission,
        async () => {
          called = true;
          return { status: 200, body: {} };
        },
        {} as NodeJS.ProcessEnv,
      ),
    ).rejects.toThrow(/switched off/);
    expect(called).toBe(false);
  });

  it("builds the Pub 5718-shaped payload: digits-only TINs, dollar strings", () => {
    const payload = buildA2aPayload(submission, "TESTTCC") as {
      schemaVersion: string;
      transmission: { tcc: string };
      submission: { payer: { tin: string }; amounts: Record<string, string> };
    };
    expect(payload.schemaVersion).toBe("5.0.7");
    expect(payload.transmission.tcc).toBe("TESTTCC");
    expect(payload.submission.payer.tin).toBe("123456789");
    expect(payload.submission.amounts.box1).toBe("2500.00");
    expect(() => buildA2aPayload({ ...submission, amountsCents: { box1: -5 } }, "T")).toThrow(/non-negative/);
  });

  it("parses accepted and rejected fixture responses", () => {
    expect(parseA2aResponse(200, { status: "ACCEPTED", receiptId: "REC-1" })).toEqual({
      accepted: true,
      receiptId: "REC-1",
      errors: [],
    });
    const rejected = parseA2aResponse(200, { status: "REJECTED", errors: ["TIN does not match"] });
    expect(rejected.accepted).toBe(false);
    expect(rejected.errors).toContain("TIN does not match");
    expect(parseA2aResponse(500, {}).accepted).toBe(false);
  });

  it("submits through the injected transport when fully configured", async () => {
    const seen: unknown[] = [];
    const result = await submitInformationReturn(
      submission,
      async (endpoint, payload) => {
        seen.push(endpoint, payload);
        return { status: 200, body: { status: "ACCEPTED", receiptId: "REC-9" } };
      },
      ON_ENV,
    );
    expect(result).toEqual({ accepted: true, receiptId: "REC-9", errors: [] });
    expect(seen[0]).toBe("https://example.invalid/iris");
  });
});
