"""Validate planning coverage; this does not certify runtime implementation."""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
folder = root / 'docs/mcp'
data = json.loads((folder / 'acceptance.json').read_text())
units = data['units']
by_id = {unit['id']: unit for unit in units}
expected = {f'MCP-{i}' for i in range(1, 12)}
errors = []
if set(by_id) != expected or len(by_id) != len(units):
    errors.append('Expected each original MCP-1 through MCP-11 exactly once')
if not re.fullmatch('[a-f0-9]{40}', data['designBaseline']):
    errors.append('Invalid inspected source revision')
roadmap = (folder / 'ROADMAP.md').read_text()
seen, visiting = set(), set()
def visit(key):
    if key in visiting:
        errors.append(f'Dependency cycle at {key}')
        return
    if key in seen:
        return
    visiting.add(key)
    for dep in by_id[key]['dependsOn']:
        if dep not in by_id:
            errors.append(f'{key}: missing dependency {dep}')
        else:
            visit(dep)
    visiting.remove(key)
    seen.add(key)
for key, unit in by_id.items():
    visit(key)
    if f'## {key} —' not in roadmap:
        errors.append(f'{key}: missing original outcome heading')
    if not unit['criteria'] or not unit['testPaths']:
        errors.append(f'{key}: missing acceptance or named tests')
    criterion_ids = [criterion['id'] for criterion in unit['criteria']]
    if len(set(criterion_ids)) != len(criterion_ids):
        errors.append(f'{key}: duplicate criterion identifiers')
    for criterion in unit['criteria']:
        if criterion['status'] == 'PASSED' and not criterion['evidence']:
            errors.append(f'{key}: pass without evidence')
    if unit['status'] == 'NOT_STARTED' and any(criterion['status'] != 'NOT_RUN' for criterion in unit['criteria']):
        errors.append(f'{key}: acceptance status contradicts not-started unit')
    for path in unit['testPaths']:
        if not re.fullmatch(r'(tests|e2e)/[A-Za-z0-9_./-]+\.(test\.tsx?|spec\.ts)', path) or '..' in path.split('/'):
            errors.append(f'{key}: invalid planned test selector {path}')
for path in [*folder.glob('*.md'), root / 'docs/pr-cards/MCP-1.md']:
    for target in re.findall(r'\]\(([^)]+)\)', path.read_text()):
        target = target.split('#', 1)[0]
        if not target or re.match(r'\w+://', target):
            continue
        if not (path.parent / target).exists():
            errors.append(f'{path.relative_to(root)}: broken relative link {target}')
external_ids = [row['id'] for row in data['externalAcceptance']]
if len(set(external_ids)) != len(external_ids):
    errors.append('Duplicate external acceptance IDs')
for row in data['externalAcceptance']:
    if not row['prerequisite'] or not row['nextAction'] or not row['responsible']:
        errors.append(f'{row["id"]}: missing scoped prerequisite/resumption action')
if errors:
    raise SystemExit('\n'.join(errors))
print(f'PASS: {len(units)} original MCP subsections, {sum(len(u["criteria"]) for u in units)} acceptance criteria, acyclic dependencies, safe planned selectors, links and external prerequisites. No runtime acceptance asserted.')
