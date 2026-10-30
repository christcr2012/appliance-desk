// AR-10 §0: measure what is left before converting anything. Prints only;
// changes nothing. Four sections:
//   1. desk pages and whether each is in docs/build-specs/migrated-pages.json
//   2. files under src/components/ui and src/components/desk with the number
//      of source files importing each (zero importers = deletion candidates)
//   3. EVERYDAY_BANNED hits in files where the everyday list does not yet
//      apply (the plain-words fix list for §2)
//   4. manualOnlyReason routes in e2e/route-inventory.ts (the §3 cut list)
// Run from the repo root: node scripts/ar10-inventory.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { EVERYDAY_BANNED, isEverydayScreen, visibleText } from "./check-owner-wording.mjs";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

function walk(dir, suffixes, out = []) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(path, suffixes, out);
    else if (suffixes.some((s) => entry.name.endsWith(s))) out.push(path);
  }
  return out;
}

// --- 1. Desk pages vs the migrated registry -------------------------------
const migrated = JSON.parse(read("docs/build-specs/migrated-pages.json"));
const migratedPaths = new Set(migrated.map((item) => (typeof item === "string" ? item : item.file)));
const deskPages = walk("src/app/desk", ["page.tsx"]).sort();
const unmigrated = deskPages.filter((p) => !migratedPaths.has(p));
console.log(`== Desk pages: ${deskPages.length} total, ${migratedPaths.size} in migrated-pages.json, ${unmigrated.length} NOT migrated ==`);
for (const p of unmigrated) console.log(`  NOT-MIGRATED ${p}`);

// --- 2. Old component importer counts --------------------------------------
const allSources = [...walk("src", [".ts", ".tsx"]), ...walk("e2e", [".ts", ".tsx"])];
const sourceTexts = new Map(allSources.map((p) => [p, read(p)]));
const components = [...walk("src/components/ui", [".ts", ".tsx"]), ...walk("src/components/desk", [".ts", ".tsx"])]
  .filter((p) => !p.endsWith("/index.ts"))
  .sort();
// Barrel re-exports: a component exported by its directory's index.ts is
// imported by symbol through the barrel path, so count those importers too.
const barrelSymbols = new Map(); // component path -> { barrelAlias, symbols[] }
for (const dir of ["src/components/ui", "src/components/desk"]) {
  const indexPath = `${dir}/index.ts`;
  if (!sourceTexts.has(indexPath)) continue;
  for (const m of sourceTexts.get(indexPath).matchAll(/export\s*\{([^}]*)\}\s*from\s*"\.\/([^"]+)"/g)) {
    const symbols = m[1].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim()).filter(Boolean);
    barrelSymbols.set(`${dir}/${m[2]}.tsx`, { barrelAlias: `@/${dir.slice(4)}`, symbols });
  }
}
console.log(`\n== Old components (src/components/ui + src/components/desk): ${components.length} files ==`);
for (const comp of components) {
  const noExt = comp.replace(/\.tsx?$/, "");
  const alias = "@/" + noExt.slice("src/".length);
  const relPath = noExt.slice("src/".length); // e.g. components/ui/day-timeline
  const compDir = comp.slice(0, comp.lastIndexOf("/"));
  const baseName = noExt.split("/").pop();
  let importers = 0;
  for (const [path, text] of sourceTexts) {
    if (path === comp) continue;
    // Direct path imports: "@/..." alias, a relative path ending in this
    // file's src-relative path, or "./basename" from the same directory.
    const viaAlias = text.includes(`"${alias}"`) || text.includes(`'${alias}'`);
    const viaRelative =
      new RegExp(`from\\s+["'][^"']*/${relPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(text) ||
      (path.slice(0, path.lastIndexOf("/")) === compDir &&
        (text.includes(`from "./${baseName}"`) || text.includes(`from './${baseName}'`)));
    let viaBarrel = false;
    const barrel = barrelSymbols.get(comp);
    if (barrel && (text.includes(`from "${barrel.barrelAlias}"`) || text.includes(`from '${barrel.barrelAlias}'`))) {
      viaBarrel = barrel.symbols.some((s) => new RegExp(`\\b${s}\\b`).test(text));
    }
    if (viaAlias || viaRelative || viaBarrel) importers += 1;
  }
  console.log(`  ${importers === 0 ? "ZERO-IMPORTERS " : ""}${comp} — ${importers} importing file(s)`);
}

// --- 3. EVERYDAY_BANNED hits where the everyday list does not apply --------
const scanDirs = ["src/app/desk", "src/app/account", "src/components/desk", "src/components/kit", "src/components/ui"];
const scanFiles = [...new Set(scanDirs.flatMap((d) => walk(d, [".ts", ".tsx"])))].sort();
let hitFiles = 0;
let hitTotal = 0;
const hitLines = [];
for (const path of scanFiles) {
  if (isEverydayScreen(path)) continue; // already held to the everyday list
  const segments = visibleText(read(path));
  let fileHit = false;
  for (const rule of EVERYDAY_BANNED) {
    let count = 0;
    for (const { text } of segments) if (rule.pattern.test(text)) count += 1;
    if (count) {
      hitTotal += count;
      fileHit = true;
      hitLines.push(`  ${path} — "${rule.pattern.source}" × ${count} (say: ${rule.say})`);
    }
  }
  if (fileHit) hitFiles += 1;
}
console.log(`\n== EVERYDAY_BANNED hits outside the everyday set: ${hitTotal} hits ==`);
for (const line of hitLines) console.log(line);

// --- 4. Manual-only accessibility routes ------------------------------------
const routeInventory = read("e2e/route-inventory.ts");
const entries = [...routeInventory.matchAll(/path:\s*"([^"]+)"([\s\S]*?)(?=\n\s*\{\s*path:|\n\];)/g)];
const manual = [];
for (const [, path, rest] of entries) {
  const m = rest.match(/manualOnlyReason:\s*"([^"]+)"/);
  if (m) manual.push({ path, reason: m[1] });
}
console.log(`\n== Manual-only accessibility routes: ${manual.length} ==`);
for (const r of manual) console.log(`  ${r.path} — ${r.reason}`);
