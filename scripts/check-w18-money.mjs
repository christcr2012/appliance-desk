import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const violations = [];
function scan(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) { scan(path); continue; }
    if (!entry.name.endsWith(".tsx")) continue;
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (/\b(?:\w*Cents|cents)\s*\/\s*100\b/.test(line))
        violations.push(`${path}:${index + 1}: format money with the shared helper`);
      if (/>[^{}<>]*\b(?:cents|cent)\b[^{}<>]*</i.test(line))
        violations.push(`${path}:${index + 1}: screen text must use dollars`);
    });
  }
}
scan("src/app");
scan("src/components");
if (violations.length) { console.error(violations.join("\n")); process.exitCode = 1; }
else console.log("W-18 plain money checks passed.");
