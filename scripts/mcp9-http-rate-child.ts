import { createServer } from "node:http";
import { prisma } from "../src/lib/prisma";
import { GET as rtcWhoami } from "../src/app/api/whoami/route";

/**
 * Disposable-PostgreSQL RTC fixture. Each process imports the real route,
 * authentication and database limiter; no credentials are passed on argv.
 */
const server = createServer(async (incoming, outgoing) => {
  if (incoming.method !== "GET" || incoming.url?.split("?")[0] !== "/api/whoami") {
    outgoing.writeHead(404).end();
    return;
  }
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(", "));
    }
    const req = new Request("http://127.0.0.1" + incoming.url, { headers });
    const response = await rtcWhoami(req);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(await response.text());
  } catch {
    // Deliberately omit error internals and input headers from subprocess logs.
    outgoing.writeHead(500, { "Content-Type": "application/json" });
    outgoing.end(JSON.stringify({ ok: false, error: { code: "service_error",
      what: "RTC fixture failed", cause: "Synthetic server error",
      todo: "Inspect disposable database test", technical: "" } }));
  }
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    process.stderr.write("RTC HTTP fixture could not bind a localhost port\n");
    process.exitCode = 1;
    server.close();
    return;
  }
  // The only stdout record is the loopback URL; never print the bearer pass.
  process.stdout.write("http://127.0.0.1:" + address.port + "\n");
});

process.once("SIGTERM", () => {
  server.closeAllConnections();
  server.close(() => {
    void prisma.$disconnect().finally(() => { process.exitCode = 0; });
  });
});
