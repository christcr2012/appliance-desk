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
expected = {'T', 'S', 'COM-L', 'W', 'V', 'F2', 'K', 'K-CASH', 'M', 'O', 'COM-N', 'BP'}
if {c['batch'] for c in CARDS} != expected:
    errors.append('remaining batch coverage changed; reconcile acceptance explicitly')
# Intentional acceptance scope changes update this reviewed constant. Card IDs
# and grouping may change; acceptance units cannot silently disappear.
REQUIRED_UNITS = set("""
BP-1 BP-10 BP-11A BP-11B BP-12 BP-13A BP-13B BP-14
BP-15A BP-15B BP-16 BP-2A BP-2B BP-3 BP-4 BP-5
BP-6 BP-7A BP-7B BP-8 BP-9 COM-L10 COM-L11 COM-L12
COM-L13A COM-L13B COM-L14A COM-L14B COM-L15 COM-L1A COM-L1B COM-L2
COM-L3 COM-L4A COM-L4B COM-L5A COM-L5B COM-L6A COM-L6B COM-L7
COM-L8 COM-L9 COM-N1A COM-N1B COM-N1C COM-N2 COM-N3 COM-N4
ENH-F ENH-K ENH-O ENH-S F2-A F2-B F2-C F2-D
K-1A K-1B K-2A K-2B K-3 K-4A K-4B K-5
K-6 K-7 K-8 M-1A M-1B M-1C M-1D M-2A
M-2B M-2C M-3 O-1 O-2A O-2B O-3A O-3B
O-4 O-5 O-6 O-7 S-1A S-1B S-1C S-2
T-6C1 T-6C2 T-6C3 T-6C4 T-6D1 T-6D2 T-6D3 T-6b2
T-7A T-7B T-7C T-7D V-1 V-2 V-3 V-4
V-C1 V-C2 V-C3 V-C4 V-C5
W-0A W-0B W-0C W-1 W-2 W-3 W-4 W-5 W-6 W-7 W-8 W-9 W-10 W-11 W-12 W-13 W-14 W-15 W-16A W-16B W-17 W-18 W-19 W-20 W-21 W-22 W-23
K-CASH-1 K-CASH-2 K-CASH-3 K-CASH-4A K-CASH-4B K-CASH-5A K-CASH-5B K-CASH-6 K-CASH-7
""".split())
actual_units = {unit for card in CARDS for unit in card['units']}
if actual_units != REQUIRED_UNITS:
    errors.append(f'acceptance coverage mismatch: missing={sorted(REQUIRED_UNITS-actual_units)}; unexpected={sorted(actual_units-REQUIRED_UNITS)}')
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
print(f'PASS: {len(CARDS)} card groups / {len(actual_units)} pinned acceptance units; acyclic prerequisites; cards, evidence, enhancement ownership and changed active links verified.')
