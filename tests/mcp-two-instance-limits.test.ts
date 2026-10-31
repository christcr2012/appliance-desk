import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";

async function oneServer(bucket: string): Promise<{ accepted: number; rejected: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath,
      ["--import", "tsx", "scripts/mcp9-rate-child.ts", bucket],
      { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", chunk => { out += String(chunk); });
    child.stderr.on("data", chunk => { err += String(chunk); });
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) {
        const firstError = err.split(/\r?\n/).find(line =>
          /Error|ERR_|Cannot|permission|Prisma/.test(line)) ?? "unknown child failure";
        return reject(new Error("Synthetic limiter worker failed (exit " + code + "): " +
          firstError.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]").slice(0, 500)));
      }
      try { resolve(JSON.parse(out)); } catch { reject(new Error("No valid limiter result")); }
    });
  });
}

describe("MCP-9 two-instance database rate-limit proof", () => {
  it("two real processes sharing PostgreSQL admit exactly the first four calls", async () => {
    const bucket = "rtc-limit-process-fixture-" + randomUUID();
    const workers = await Promise.all([oneServer(bucket), oneServer(bucket)]);
    expect(workers.reduce((n, w) => n + w.accepted, 0)).toBe(4);
    expect(workers.reduce((n, w) => n + w.rejected, 0)).toBe(4);
  }, 30_000);
});
