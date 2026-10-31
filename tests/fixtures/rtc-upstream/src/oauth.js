// Fixture adapters inspect connector settings only in local server CI, never on production.
export async function verifyRefreshSettings(adapter) {
  if (!adapter || typeof adapter.inspect !== 'function' ||
      typeof adapter.refresh !== 'function') throw new TypeError('OAuth fixture adapter required');
  const before = await adapter.inspect();
  const access = await adapter.refresh();
  const after = await adapter.inspect(access);
  for (const field of ['profile', 'listing', 'areas', 'mode', 'account']) {
    if (JSON.stringify(before?.[field]) !== JSON.stringify(after?.[field])) {
      throw new Error('§2: OAuth refresh changed ' + field + ' (connection restrictions must survive)');
    }
  }
  return { preserved: true };
}
