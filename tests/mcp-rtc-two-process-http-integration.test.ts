import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { issueRtcPass, revokeRtcPass } from "@/domains/agent-control/passes";
import { verifyTwoInstanceRateLimit } from "./fixtures/rtc-upstream/src/rate-limit.js";

const ownerId = "rtc-http-owner-" + randomUUID();
const processes: ChildProcessWithoutNullStreams[] = [];
let pass: Awaited<ReturnType<typeof issueRtcPass>> | undefined;

function startServer(): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath,
      ["--import", "tsx", "scripts/mcp9-http-rate-child.ts"],
      { cwd: process.cwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    processes.push(child);
    let complete = false;
    let line = "";
    const finish = (url?: string) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      if (url) resolve(url);
      else reject(new Error("Independent RTC HTTP fixture failed to start"));
    };
    const timer = setTimeout(() => finish(), 30_000);
    child.stdout.on("data", (chunk: Buffer) => {
      line += String(chunk);
      const boundary = line.indexOf("\n");
      if (boundary < 0) return;
      const url = line.slice(0, boundary).trim();
      finish(/^http:\/\/127\.0\.0\.1:\d+$/.test(url) ? url : undefined);
    });
    child.on("error", () => finish());
    child.on("close", () => finish());
    // stderr deliberately remains unreadable in assertions: credentials
    // and database connection details must never enter test reports.
    child.stderr.resume();
  });
}

async function stopServer(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => {
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("close", () => { clearTimeout(timeout); resolve(); });
    child.kill("SIGTERM");
  });
}

describe("MCP-9 pinned RTC HTTP limit across two independent servers", () => {
  beforeAll(async () => {
    await prisma.user.create({ data: {
      id: ownerId, email: ownerId + "@example.test",
      name: "Synthetic RTC HTTP owner", role: "OWNER", twoFactorEnabled: true,
    } });
    pass = await issueRtcPass(ownerId, {
      label: "Synthetic two-server rate limit",
      scopes: ["ops:read"],
      areas: ["health"],
    });
  });

  afterAll(async () => {
    await Promise.all(processes.map(stopServer));
    if (pass) {
      const digest = createHash("sha256").update("rtc:" + pass.id).digest("hex");
      await prisma.verification.deleteMany({
        where: { id: "rate_limit_" + digest },
      });
      await prisma.agentPass.deleteMany({ where: { id: pass.id } });
      await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
      await prisma.mcpConnection.deleteMany({ where: { id: pass.connectionId } });
    }
    await prisma.user.deleteMany({ where: { id: ownerId } });
    await prisma.$disconnect();
  });

  it("passes the immutable upstream two-instance HTTP admission probe and rejects revoked passes", async () => {
    if (!pass) throw new Error("Synthetic owner pass was not created");
    const urls = await Promise.all([startServer(), startServer()]);
    expect(urls[0]).not.toBe(urls[1]);
    const result = await verifyTwoInstanceRateLimit({
      urls, pass: pass.secret, limit: 120,
    });
    expect(result).toEqual({ successes: 120, limited: 60 });

    await revokeRtcPass(ownerId, pass.id);
    for (const url of urls) {
      const response = await fetch(url + "/api/whoami", {
        headers: { authorization: "Bearer " + pass.secret },
        signal: AbortSignal.timeout(10_000),
      });
      expect(response.status).toBe(401);
      expect((await response.json()).error.code).toBe("pass_revoked");
    }
  }, 120_000);
});
