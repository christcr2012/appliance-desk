import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { customerContactKeys } from "@/domains/customers/keys";

describe("customerContactKeys", () => {
  it("keeps digits only from a formatted phone number", () => {
    expect(customerContactKeys({ phone: "(970) 555-0134" })).toEqual({
      phoneDigits: "9705550134",
    });
  });

  it("returns a null key for blank or digit-free phones", () => {
    expect(customerContactKeys({ phone: "  " })).toEqual({ phoneDigits: null });
    expect(customerContactKeys({ phone: null })).toEqual({ phoneDigits: null });
    expect(customerContactKeys({})).toEqual({ phoneDigits: null });
    expect(customerContactKeys({ phone: "deleted" }).phoneDigits).toBeNull();
  });
});

/**
 * CU-1 guard (the LD-1 lead pattern): every customer write that sets `phone`
 * must maintain `phoneDigits` in the same call — directly or via the
 * customerContactKeys spread — or phone search silently goes stale. Customer
 * writes live across the whole src tree (customers, leads conversion, privacy
 * deletion, billing), so the whole tree is scanned.
 */
const root = process.cwd();

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** The text of one `….customer.create(…)` / `update(…)` / `updateMany(…)` call, braces balanced. */
function customerWriteCalls(text: string): string[] {
  const calls: string[] = [];
  const re = /\.customer\.(create|update|updateMany)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    let depth = 0;
    let i = match.index + match[0].length - 1; // the opening "("
    for (; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(text.slice(match.index, i + 1));
  }
  return calls;
}

describe("customer writes maintain their phone key", () => {
  it("every customer.create/update/updateMany that sets phone also sets phoneDigits", () => {
    const files = sourceFiles(join(root, "src"));
    expect(files.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const call of customerWriteCalls(text)) {
        if (!/\bphone\s*:/.test(call)) continue;
        if (call.includes("customerContactKeys") || call.includes("phoneDigits")) continue;
        offenders.push(`${file}: sets phone without phoneDigits`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
