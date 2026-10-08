"""Validate the compact work queue without invoking application infrastructure."""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = json.loads((ROOT / 'docs/pr-cards/work-index.json').read_text())
CARDS = DATA['cards']
BY_ID = {card['id']: card for card in CARDS}
errors = []
if len(BY_ID) != len(CARDS):
    errors.append('duplicate card IDs')
expected = {'T', 'S', 'COM-L', 'V', 'F2', 'K', 'M', 'O', 'COM-N', 'BP'}
if {c['batch'] for c in CARDS} != expected:
    errors.append('remaining batch coverage changed; reconcile acceptance explicitly')
seen, active = set(), set()
def visit(key):
    if key in active:
        errors.append(f'dependency cycle at {key}')
        return
    if key in seen:
        return
    active.add(key)
    for dep in BY_ID[key]['dependencies']:
        if dep not in BY_ID:
            errors.append(f'{key}: missing prerequisite {dep}')
        else:
            visit(dep)
    active.remove(key)
    seen.add(key)
for card in CARDS:
    visit(card['id'])
    path = ROOT / card.get('card', card.get('plannedCard', 'MISSING'))
    if card['readiness'] != 'WRITE_CARD_AT_START' and not path.is_file():
        errors.append(f"{card['id']}: missing existing card {path}")
    if card['readiness'] == 'READY_AFTER_PREREQUISITE' and path.is_file():
        if 'DRIFT-PROTOCOL.md' not in path.read_text():
            errors.append(f"{card['id']}: missing per-card drift procedure")
        for source in card['evidence']:
            if not (ROOT / source).exists():
                errors.append(f"{card['id']}: cited current evidence missing: {source}")
    if not card['units']:
        errors.append(f"{card['id']}: no acceptance units")
for extra in DATA.get('enhancements', []):
    owner = BY_ID.get(extra['owner'])
    if not owner or extra['id'] not in owner['units']:
        errors.append(f"{extra['id']}: no owning capability")
# Validate local Markdown links in changed active docs. Retired snapshots retain
# original historical paths; their current archive landing page is checked.
changed = subprocess.check_output(['git', 'diff', '--name-only', 'origin/main'], cwd=ROOT, text=True).splitlines()
for name in changed:
    path = ROOT / name
    if path.suffix != '.md' or not path.exists():
        continue
    if '/archive/' in name and path.name != 'README.md':
        continue
    for target in re.findall(r'\]\(([^)]+)\)', path.read_text()):
        target = target.split('#', 1)[0]
        if not target or re.match(r'\w+://', target) or target.startswith('mailto:'):
            continue
        if not (path.parent / target).exists():
            errors.append(f'{name}: broken relative link {target}')
if errors:
    raise SystemExit('\n'.join(errors))
print(f'PASS: {len(CARDS)} unique units; acyclic prerequisites; cards, evidence, enhancement ownership and changed active links verified.')
