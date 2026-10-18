// Scaffolds the paperwork for a new bundle so nobody has to guess the file shapes.
// Usage: npm run bundle:new -- <BUNDLE-ID> [--base <sha>] [--subsections A-1,A-2] [--dry-run]
// Every field you must write yourself starts with "TODO:". `npm run bundle:preflight` rejects TODO text,
// so unfinished scaffolding can never be pushed by accident. Never runs tests, network or git writes.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function scaffold({ id, base, subsections }) {
  const subs = subsections.length ? subsections : [id];
  const card = [
    `# ${id} — TODO: one-line title of the outcome`,
    `Source: TODO: design file and heading, MASTER-ROADMAP section, owner direction date.`,
    `One coherent outcome: TODO: what a person can do or see when this is finished.`,
    '',
    '## Frozen original complete acceptance',
    ...subs.flatMap(s => [`### ${s}`, `- TODO: one observable, testable acceptance item (name the file, test or screen).`]),
    '',
    '## Rules this work keeps',
    'TODO: safety, money, permission and no-overclaim rules that apply here.',
    '',
    '## Excluded and deferred',
    'TODO: what is deliberately not built and where it is tracked.',
    '',
    '<!-- bundle-plan:start -->',
    '```json',
    JSON.stringify({
      workKind: 'ENGINEERING', baseRevision: base,
      outcome: 'TODO: same outcome as above in plain words',
      integrationBoundary: 'TODO: which files and layers change',
      newEngineering: 'TODO: the new work, concretely',
      estimatedProductionLines: 0,
      relatedWorkDecision: 'TODO: why these subsections ship together',
      subsections: subs.map(s => ({ id: s, acceptance: ['TODO: copy the acceptance item text exactly'], remainingEngineering: ['TODO: what is still to build'] })),
    }, null, 2),
    '```',
    '<!-- bundle-plan:end -->',
    '',
  ].join('\n');
  const packet = {
    version: 1, id, parent: id, baseline: base, card: `docs/pr-cards/${id}.md`,
    outcome: 'TODO: same outcome', risk: 'TODO: what could go wrong',
    next: 'TODO: the next action after planning is frozen',
    references: [{ path: 'TODO: real file path', anchor: 'TODO: exact text that exists in that file', purpose: 'TODO: why it matters' }],
  };
  return { card, packet };
}

function arg(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; }

export function main(root = process.cwd()) {
  const id = process.argv[2];
  if (!id || id.startsWith('--') || !/^[A-Za-z0-9._-]+$/.test(id)) { console.error('Usage: npm run bundle:new -- <BUNDLE-ID> [--base <sha>] [--subsections A-1,A-2] [--dry-run]'); return 2; }
  const base = arg('--base') ?? spawnSync('git', ['rev-parse', 'origin/main'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(base)) { console.error('Could not find origin/main; pass --base <40-character commit>.'); return 2; }
  const subsections = (arg('--subsections') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const { card, packet } = scaffold({ id, base, subsections });
  const cardPath = join(root, 'docs/pr-cards', `${id}.md`), packetPath = join(root, 'docs/pr-cards/execution', `${id}.json`);
  if (process.argv.includes('--dry-run')) { console.log(card); return 0; }
  for (const p of [cardPath, packetPath]) if (existsSync(p)) { console.error(`${p} already exists; refusing to overwrite.`); return 1; }
  mkdirSync(join(root, 'docs/pr-cards/execution'), { recursive: true });
  writeFileSync(cardPath, card); writeFileSync(packetPath, JSON.stringify(packet, null, 2) + '\n');
  console.log(`Created docs/pr-cards/${id}.md and docs/pr-cards/execution/${id}.json.\nNext: replace every TODO, then follow docs/AGENT-QUICKSTART.md step 2 (planning commit).`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main());
