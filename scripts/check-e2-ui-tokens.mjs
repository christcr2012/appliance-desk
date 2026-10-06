import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "src", "components", "ui");
if (!fs.existsSync(root)) process.exit(0);

const forbidden = [
  { pattern: /#[0-9a-fA-F]{3,8}\b/, reason: "hard-coded hex color" },
  { pattern: /\b(?:rgb|hsl)\(/, reason: "hard-coded rgb/hsl color" },
  { pattern: /\[(?:#|rgb|hsl|\d+px)/, reason: "arbitrary color or px value" },
  {
    pattern: /\brounded-(?:sm|md|lg|xl|2xl|3xl)\b/,
    reason: "legacy radius instead of rounded-control/rounded-card",
  },
];

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && entry.name.endsWith(".tsx")) files.push(full);
  }
}
walk(root);

const violations = [];
for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of forbidden) {
      if (rule.pattern.test(line)) {
        violations.push(
          `${path.relative(process.cwd(), file)}:${index + 1}: ${rule.reason}`,
        );
      }
    }
  });
}

if (violations.length > 0) {
  console.error(
    "E2 shared UI must use design tokens only:\n" + violations.join("\n"),
  );
  process.exit(1);
}
