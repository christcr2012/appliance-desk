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

test("Metricool image permission is restricted to public-layout documents", async ({ request }) => {
  for (const path of ["/", "/launch", "/pricing", "/privacy", "/terms", "/accessibility", "/rent/greeley"]) {
    const response = await request.get(path);
    const csp = response.headers()["content-security-policy"];
    expect(csp).toContain("img-src 'self' https://tracker.metricool.com;");
    expect(csp.split("script-src")[1].split(";")[0]).not.toContain("metricool");
  }
  for (const path of ["/login", "/desk", "/account", "/sign/private", "/api/uploads/photo"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()["content-security-policy"]).not.toContain("tracker.metricool.com");
  }
});


test("a client transition from privacy to how-it-works retains public tracker image permission", async ({ page }) => {
  await page.route("https://tracker.metricool.com/c3po.jpg*", route => route.fulfill({
    status: 200, contentType: "image/gif",
    body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
  }));
  await page.goto("/privacy");
  await page.evaluate(() => { document.documentElement.dataset.metricoolTransition = "same-document"; });
  await page.getByRole("link", { name: "How It Works", exact: true }).first().click();
  await expect(page).toHaveURL(/\/how-it-works$/);
  expect(await page.evaluate(() => document.documentElement.dataset.metricoolTransition)).toBe("same-document");
  const sent = page.waitForRequest("https://tracker.metricool.com/c3po.jpg?test=public-transition");
  await page.evaluate(() => {
    const image = new Image();
    image.src = "https://tracker.metricool.com/c3po.jpg?test=public-transition";
  });
  await sent;
});
