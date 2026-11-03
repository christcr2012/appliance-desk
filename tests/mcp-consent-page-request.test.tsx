import { beforeAll, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

// Regression test for the second hosted consent failure (MCP-9 trial,
// 2026-11-03): the provider seals the authorization request it sends to the
// consent page — a signature (`sig`) plus a REPEATED `ba_param` field naming
// every field the signature covers. Next delivers a repeated query field to
// the page as a string array, and the page used to keep only plain string
// values when it rebuilt the request into the form's hidden `oauthQuery`
// field, silently dropping the whole `ba_param` list (and any other repeated
// field). The provider then found no signed-field list, refused the consent
// submission with "invalid signature", and Allow could never record a
// connection — even with the action's Origin fix (PR #835) in place. The
// loopback round-trip suite cannot see this: it hands the action a query it
// built itself from the provider's redirect, never the page's rebuild. This
// test renders the real page with the request shaped the way Next delivers
// it and pins what the form carries.

const ISSUER = "https://testing.example.test";
// The signed-field names the provider appends, one `ba_param` entry each.
const SIGNED_NAMES = [
  "ba_iat", "client_id", "code_challenge", "code_challenge_method",
  "redirect_uri", "resource", "response_type", "scope", "state",
];
const RESOURCES = [
  "https://testing.example.test/api/mcp",
  "https://testing.example.test/api/mcp-alt",
];

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("TEST_NOT_FOUND"); },
}));
vi.mock("@/lib/session", () => ({
  requireRole: async () => ({ user: { id: "owner-1", name: "Testing Owner", role: "OWNER" } }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    oauthClient: {
      findFirst: async () => ({ clientId: "client-1", name: "Trial assistant" }),
    },
  },
}));
vi.mock("@/app/connect/consent/actions", () => ({
  respondToAssistantConsent: async () => {},
}));

import ConsentPage from "@/app/connect/consent/page";

// The request exactly as Next's searchParams delivers it: single fields as
// strings, the repeated `ba_param` seal list and repeated `resource` fields
// as string arrays.
function sealedSearchParams() {
  return {
    client_id: "client-1",
    redirect_uri: "https://agent.meta.ai/api/hatch/oauth/callback",
    response_type: "code",
    scope: "ops:read decisions:read offline_access",
    state: "trial-state",
    code_challenge: "challenge-abc",
    code_challenge_method: "S256",
    resource: [...RESOURCES],
    ba_iat: "1762214400000",
    sig: "sealed-signature",
    ba_param: [...SIGNED_NAMES],
  };
}

function entriesOf(params: URLSearchParams): [string, string][] {
  return [...params.entries()].sort(([ka, va], [kb, vb]) =>
    ka === kb ? (va < vb ? -1 : va > vb ? 1 : 0) : ka < kb ? -1 : 1);
}

async function renderedOauthQuery(): Promise<string> {
  const html = renderToString(await ConsentPage({ searchParams: Promise.resolve(sealedSearchParams()) }));
  expect(html).toContain("Trial assistant");
  const host = document.createElement("div");
  host.innerHTML = html;
  const input = host.querySelector<HTMLInputElement>('input[name="oauthQuery"]');
  expect(input, "the consent form must carry the sealed request").not.toBeNull();
  return input!.value;
}

beforeAll(() => {
  process.env.MCP_ISSUER_URL = ISSUER;
});

describe("assistant consent page's form request", () => {
  it("carries the provider's sealed request whole, repeated fields included", async () => {
    const carried = new URLSearchParams(await renderedOauthQuery());
    // The pinned regression: the seal's field list arrives as repeats and
    // must survive in full and in order, or the provider refuses consent.
    expect(carried.getAll("ba_param")).toEqual(SIGNED_NAMES);
    // Any repeated field survives, not just the seal's.
    expect(carried.getAll("resource")).toEqual(RESOURCES);
    // And every single field is carried unchanged.
    expect(carried.get("client_id")).toBe("client-1");
    expect(carried.get("redirect_uri")).toBe("https://agent.meta.ai/api/hatch/oauth/callback");
    expect(carried.get("response_type")).toBe("code");
    expect(carried.get("scope")).toBe("ops:read decisions:read offline_access");
    expect(carried.get("state")).toBe("trial-state");
    expect(carried.get("code_challenge")).toBe("challenge-abc");
    expect(carried.get("code_challenge_method")).toBe("S256");
    expect(carried.get("ba_iat")).toBe("1762214400000");
    expect(carried.get("sig")).toBe("sealed-signature");
  });

  it("leaves the provider's signed subset identical to the request it sealed", async () => {
    const carried = new URLSearchParams(await renderedOauthQuery());
    // Rebuild the signed subset the way the provider does when it verifies:
    // `sig`, every `ba_param` entry, and every entry whose name is listed.
    const signedSubset = (params: URLSearchParams) => {
      const names = new Set(params.getAll("ba_param"));
      const subset = new URLSearchParams();
      for (const [key, value] of params.entries()) {
        if (key === "sig" || key === "ba_param" || names.has(key)) subset.append(key, value);
      }
      return entriesOf(subset);
    };
    const original = new URLSearchParams();
    for (const [key, value] of Object.entries(sealedSearchParams())) {
      if (typeof value === "string") original.append(key, value);
      else for (const entry of value) original.append(key, entry);
    }
    expect(signedSubset(carried)).toEqual(signedSubset(original));
    // Nothing at all was dropped on the way through the page.
    expect(entriesOf(carried)).toEqual(entriesOf(original));
  });
});
