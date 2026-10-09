import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTransfer, joinParts, sha256, splitParts } from './sandbox-transfer.mjs';

function transfer(bytes = Buffer.from('a git bundle stand-in '.repeat(500)), size = 1000) {
  const parts = splitParts(bytes.toString('base64'), size);
  const files = Object.fromEntries(parts.map((body, i) => [`part-${String(i).padStart(3, '0')}`, body]));
  const manifest = {
    version: 1, target: 'ai/sol/w-0a', base: 'a'.repeat(40), head: 'b'.repeat(40), commits: 2,
    bundleBytes: bytes.length, bundleSha256: sha256(bytes),
    parts: Object.entries(files).map(([name, body]) => ({ name, sha256: sha256(body) })),
  };
  return { bytes, files, manifest };
}

test('a complete, intact transfer has no problems and rebuilds byte for byte', () => {
  const { bytes, files, manifest } = transfer();
  assert.ok(manifest.parts.length > 5);
  assert.deepEqual(checkTransfer(manifest, files), []);
  assert.deepEqual(joinParts(manifest, files), bytes);
});

test('a cut-off part is named so it can be uploaded again', () => {
  const { files, manifest } = transfer();
  files['part-002'] = files['part-002'].slice(0, 500);
  assert.deepEqual(checkTransfer(manifest, files), ['part-002 is damaged or cut off — upload it again']);
});

test('a part not yet uploaded is reported, and extra parts are refused', () => {
  const { files, manifest } = transfer();
  delete files['part-001'];
  files['part-099'] = 'x';
  assert.deepEqual(checkTransfer(manifest, files),
    ['part-001 has not been uploaded yet', 'unexpected parts: part-099']);
});

test('only ai/ branches can be targets, never main or a path trick', () => {
  for (const target of ['main', 'ai/../main', 'refs/heads/main', 'ai/', 'feature/x']) {
    const { files, manifest } = transfer();
    manifest.target = target;
    assert.ok(checkTransfer(manifest, files).some(p => p.startsWith('target must')), target);
  }
});

test('a bundle that does not match its fingerprint is rejected', () => {
  const { files, manifest } = transfer();
  manifest.bundleSha256 = 'c'.repeat(64);
  assert.deepEqual(checkTransfer(manifest, files), []);
  assert.throws(() => joinParts(manifest, files), /fingerprint/);
});

test('a missing or wrong-version manifest is not ready', () => {
  assert.deepEqual(checkTransfer(undefined, {}), ['manifest.json is missing or not version 1']);
  assert.deepEqual(checkTransfer({ version: 2 }, {}), ['manifest.json is missing or not version 1']);
});
