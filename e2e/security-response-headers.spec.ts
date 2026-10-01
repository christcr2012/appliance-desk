import { test, expect } from "@playwright/test";

test("built public pages and static assets emit the configured HSTS policy", async ({ request }) => {
  // CI runs next build + next start. HTTP loopback proves response emission;
  // it does not claim that a browser enforces HSTS without an HTTPS origin.
  for (const path of ["/", "/pricing", "/theme-init.js"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["strict-transport-security"], path)
      .toBe("max-age=31536000; includeSubDomains");
  }
});

test("protected redirects and rejected APIs retain HSTS at the response boundary", async ({ request }) => {
  // Fresh anonymous context; disable redirects to inspect the protected response.
  const protectedResponse = await request.get("/desk", { maxRedirects: 0 });
  expect([307, 308]).toContain(protectedResponse.status());
  expect(protectedResponse.headers().location).toContain("/login");
  expect(protectedResponse.headers()["strict-transport-security"])
    .toBe("max-age=31536000; includeSubDomains");
  const apiResponse = await request.post("/api/uploads/photo", { data: {} });
  expect(apiResponse.status()).toBe(401);
  expect(apiResponse.headers()["strict-transport-security"])
    .toBe("max-age=31536000; includeSubDomains");
});
