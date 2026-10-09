import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, inventoryRoutes, suggestion } from './check-route-inventory.mjs';

test('missing, stale and duplicate routes are all reported', () => {
  assert.deepEqual(compare(['/', '/desk/new'], ['/', '/old', '/', ]), { missing: ['/desk/new'], stale: ['/old'], duplicates: ['/'] });
});
test('inventory paths are read from both one-line and multi-line entries', () => {
  const source = '  { path: "/", role: "PUBLIC", fixture: "/" },\n  {\n    path: "/estimate/[id]",\n    role: "PUBLIC",\n';
  assert.deepEqual(inventoryRoutes(source), ['/', '/estimate/[id]']);
});
test('suggestions pick the role from the area and mark dynamic routes for a human', () => {
  assert.match(suggestion('/desk/taxes'), /role: "OWNER", fixture: "\/desk\/taxes"/);
  assert.match(suggestion('/portal/bills'), /role: "CUSTOMER"/);
  assert.match(suggestion('/rent/[city]'), /manualOnlyReason/);
});
