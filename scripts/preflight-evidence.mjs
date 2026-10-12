// Bounded local timings; these are observations, never merge/acceptance evidence.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordDir } from './check-cache.mjs';

export function recordTiming(entry, dir = recordDir()) {
  if (!['passed', 'failed', 'cached'].includes(entry.status) || !Number.isFinite(entry.elapsedMs) || entry.elapsedMs < 0 ||
      !Array.isArray(entry.commands) || entry.commands.some(c => !Array.isArray(c) || c.some(s => typeof s !== 'string')))
    throw new Error('Invalid local timing record');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'preflight-runs.jsonl');
  const previous = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).slice(-199) : [];
  const row = { at: new Date().toISOString(), status: entry.status, elapsedMs: entry.elapsedMs, commands: entry.commands };
  writeFileSync(file, [...previous, JSON.stringify(row)].join('\n') + '\n', { mode: 0o600 });
}
