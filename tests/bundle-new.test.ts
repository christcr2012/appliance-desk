import { describe, expect, it } from 'vitest';
import { scaffold } from '../scripts/bundle-new.mjs';
import { findPlaceholders } from '../scripts/bundle-preflight.mjs';

describe('bundle scaffold', () => {
  const base = 'a'.repeat(40);
  it('writes one acceptance placeholder per subsection and a parseable plan block', () => {
    const { card, packet } = scaffold({ id: 'X-1', base, subsections: ['X-1A', 'X-1B'] });
    expect(card).toContain('### X-1A');
    expect(card).toContain('### X-1B');
    const json = card.split('```json')[1].split('```')[0];
    const plan = JSON.parse(json);
    expect(plan.baseRevision).toBe(base);
    expect(plan.subsections.map((s: { id: string }) => s.id)).toEqual(['X-1A', 'X-1B']);
    expect(packet.baseline).toBe(base);
  });
  it('defaults to a single subsection named like the bundle', () => {
    expect(scaffold({ id: 'X-2', base, subsections: [] }).card).toContain('### X-2');
  });
  it('is unfinished until a person replaces every TODO (preflight rejects it)', () => {
    const { card } = scaffold({ id: 'X-3', base, subsections: [] });
    expect(findPlaceholders(card).length).toBeGreaterThan(0);
  });
});
