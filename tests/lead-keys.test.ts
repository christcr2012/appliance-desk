import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { leadContactKeys } from "@/domains/leads/keys";

describe("leadContactKeys", () => {
  it("keeps digits only from a formatted phone number", () => {
    expect(leadContactKeys({ phone: "(970) 555-0134", email: null })).toEqual({
      phoneDigits: "9705550134",
      emailLower: null,
    });
  });

  it("returns null keys for blank contact details", () => {
    expect(leadContactKeys({ phone: "  ", email: "   " })).toEqual({
      phoneDigits: null,
      emailLower: null,
    });
    expect(leadContactKeys({})).toEqual({ phoneDigits: null, emailLower: null });
  });

  it("trims and lower-cases the email", () => {
    expect(leadContactKeys({ email: "  Maria@Example.COM " })).toEqual({
      phoneDigits: null,
      emailLower: "maria@example.com",
    });
  });

  it("a phone with no digits has no key, so it never matches a real number", () => {
    expect(leadContactKeys({ phone: "deleted" }).phoneDigits).toBeNull();
  });
});

/**
 * LD-1 guard: every lead write that sets `phone` or `email` must maintain
 * the matching normalized key (`phoneDigits` / `emailLower`, directly or via
 * the `leadContactKeys` spread) in the same call, or duplicate checks and
 * phone search silently go stale. Lead writes live in the leads domain, the
 * desk lead actions, and the privacy deletion — all three are scanned.
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

/** The text of one `….lead.create(…)` / `update(…)` / `updateMany(…)` call, braces balanced. */
function leadWriteCalls(text: string): string[] {
  const calls: string[] = [];
  const re = /\.lead\.(create|update|updateMany)\s*\(/g;
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

describe("lead writes maintain their contact keys", () => {
  it("every lead.create/update/updateMany that sets phone or email also sets its key", () => {
    const files = [
      ...sourceFiles(join(root, "src/domains/leads")),
      join(root, "src/app/desk/leads/actions.ts"),
      join(root, "src/domains/privacy/index.ts"),
    ];
    expect(files.length).toBeGreaterThan(3);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const call of leadWriteCalls(text)) {
        const setsPhone = /\bphone\s*:/.test(call);
        const setsEmail = /\bemail\s*:/.test(call);
        if (!setsPhone && !setsEmail) continue;
        const viaHelper = call.includes("leadContactKeys");
        if (setsPhone && !viaHelper && !call.includes("phoneDigits")) {
          offenders.push(`${file}: sets phone without phoneDigits`);
        }
        if (setsEmail && !viaHelper && !call.includes("emailLower")) {
          offenders.push(`${file}: sets email without emailLower`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
