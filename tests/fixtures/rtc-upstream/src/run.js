import { fixtureOptions, recoverResult } from './fixtures.js';
// Wire-level RTC 1 conformance: every probe uses real HTTP requests, never a service credential.
// Passes remain in memory and never enter a URL, assertion message or output.
import { verifyRefreshSettings } from './oauth.js';
import { verifyTwoInstanceRateLimit } from './rate-limit.js';
const tokenPattern = /(?:rtc_pass_[A-Za-z0-9_-]{43}|(?:sk|rk)_live_[A-Za-z0-9]{12,}|github_pat_[A-Za-z0-9_]{30,})/g;
const clean = (message, passes) => {
  let output = String(message).replace(tokenPattern, '[redacted]');
  for (const pass of Object.values(passes || {})) {
    if (pass) output = output.replaceAll(pass, '[redacted]');
  }
  return output.slice(0, 250);
};
const assert = (ok, reason) => { if (!ok) throw new Error(reason); };
const errorShape = (data, code) => data?.ok === false &&
  ['what', 'cause', 'todo', 'technical', 'code'].every((key) =>
    typeof data.error?.[key] === 'string') && (!code || data.error.code === code);
const call = async (url, pass, path, args, method) => {
  const response = await fetch(url + path, {
    method: method || (args === undefined ? 'GET' : 'POST'),
    headers: { ...(pass ? { authorization: 'Bearer ' + pass } : {}),
      ...(args === undefined ? {} : { 'content-type': 'application/json' }) },
    body: args === undefined ? undefined : JSON.stringify(args),
    signal: AbortSignal.timeout(10000)
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error('HTTP response was not valid JSON (status ' + response.status + ')'); }
  return { status: response.status, data };
};
const toolsOf = (data) => Array.isArray(data?.result?.tools) ? data.result.tools : [];
const available = (passes, key) => typeof passes[key] === 'string' && passes[key].length > 0;

export async function runConformance({ url, passes = {}, oauth, instances, fixtures } = {}) {
  if (!url || !/^https?:\/\/[^?#/]+/.test(url)) throw new TypeError('A server URL is required');
  const fixture = fixtureOptions(fixtures);
  const field = fixture?.field || 'value';
  const valueArgument = fixture?.valueArgument || 'value';
  const argsFor = role => fixture?.[role]?.args || {};
  const checks = [];
  const probe = async (name, run, { needs = [], requiresManifest = false } = {}) => {
    const missing = needs.filter((key) => !available(passes, key));
    if (missing.length || (requiresManifest && !manifest)) {
      checks.push({ name, ok: false, skipped: true,
        message: 'Skipped: ' + (missing.length ? 'missing ' + missing.join(', ') + ' pass' : 'manifest unavailable') });
      return;
    }
    try {
      await run();
      checks.push({ name, ok: true, message: 'RTC 1 rule verified' });
    } catch (e) {
      checks.push({ name, ok: false, message: clean(e.message, passes) });
    }
  };
  let manifest = null;
  await probe('manifest', async () => {
    const r = await call(url, null, '/api/contract');
    assert(r.status === 200, '§1: GET /api/contract must be public');
    const m = r.data;
    assert(m.rtc === 1 && typeof m.server === 'string' &&
      /^[a-z][a-z0-9_]*$/.test(m.prefix || '') &&
      typeof m.version === 'string', '§1: invalid RTC 1 manifest identity');
    assert(Array.isArray(m.areas) && Array.isArray(m.profiles) &&
      Array.isArray(m.listingModes) && Array.isArray(m.modes) &&
      typeof m.devTools === 'boolean', '§1: manifest arrays and devTools are required');
    assert(['tools', 'writes', 'money'].every((k) =>
      Number.isInteger(m.counts?.[k]) && m.counts[k] >= 0), '§1: invalid tool counts');
    manifest = m;
  });
  await probe('manifest.openapi', async () => {
    const r = await call(url, null, '/api/openapi.json');
    assert(r.status === 200 && String(r.data.openapi).startsWith('3.'), '§1: OpenAPI 3 description required');
    const paths = Object.values(r.data.paths || {});
    const count = paths.flatMap((p) => Object.keys(p).filter((v) =>
      ['get', 'put', 'post', 'patch', 'delete'].includes(v))).length;
    assert(count > 0 && count <= 30, '§1: OpenAPI must document 1–30 operations');
  });
  let catalog = [];
  await probe('catalog', async () => {
    const pages = new Set();
    let next = '1';
    while (next !== null) {
      assert(typeof next === 'string' && /^[1-9][0-9]*$/.test(next) && !pages.has(next) && pages.size < 100,
        '§3: invalid or cyclic catalog continuation');
      pages.add(next);
      const r = await call(url, passes.full, '/api/tools?limit=100&listing=catalog&page=' + next);
      assert(r.status === 200 && r.data.ok === true, '§3: tools catalog unavailable');
      const batch = toolsOf(r.data);
      assert(batch.length && batch.length <= 100, '§3: tools catalog invalid or exceeds page limit');
      catalog.push(...batch);
      next = r.data.result?.next ?? null;
    }
    const unique = new Set();
    for (const tool of catalog) {
      assert(typeof tool.name === 'string' && tool.name.startsWith(manifest.prefix + '_'),
        '§3: every tool name must start with ' + manifest.prefix + '_');
      assert(!unique.has(tool.name), '§3: duplicate tool name');
      unique.add(tool.name);
      assert(typeof tool.description === 'string' && tool.description.length <= 160 &&
        tool.description.length > 0, '§3: tool description exceeds 160 characters');
      assert(tool.inputSchema?.type === 'object' && typeof tool.area === 'string' &&
        Array.isArray(tool.profiles) && tool.profiles.length &&
        Array.isArray(tool.audience) && tool.audience.length, '§3: missing tool metadata');
      assert(['writes', 'money', 'destructive'].every((x) => typeof tool[x] === 'boolean') &&
        typeof tool.annotations?.idempotentHint === 'boolean' &&
        typeof tool.annotations?.openWorldHint === 'boolean' &&
        tool.annotations?.readOnlyHint === !tool.writes &&
        tool.annotations?.destructiveHint === tool.destructive,
      '§3: tool safety annotations disagree with metadata');
      if (tool.money) assert(tool.description.startsWith('MOVES MONEY:'), '§3: money warning must lead');
    }
    assert(catalog.length <= manifest.counts.tools, '§1: catalog exceeds manifest tool count');
  }, { needs: ['full'], requiresManifest: true });
  const selection = () => {
    const read = catalog.find((t) => !t.writes && (!fixture || t.name === fixture.read.name));
    const write = catalog.find((t) => t.writes && !t.money && !t.destructive && (!fixture || t.name === fixture.write.name));
    const guarded = catalog.find((t) => t.writes && (t.money || t.destructive) && (!fixture || t.name === fixture.guarded.name));
    assert(read && write && guarded, '§4: reference probes need read, write and guarded tools');
    return { read, write, guarded };
  };
  await probe('meta', async () => {
    const { read, write } = selection();
    const who = await call(url, passes.full, '/api/whoami');
    assert(who.status === 200 && who.data.ok === true, '§4: whoami must work');
    const searched = await call(url, passes.full, '/api/tools?q=' + encodeURIComponent(read.name));
    assert(toolsOf(searched.data).some((x) => x.name === read.name), '§4: search failed');
    const described = await call(url, passes.full, '/api/tools/' + encodeURIComponent(read.name));
    assert(described.data.result?.name === read.name, '§4: describe failed');
    const batch = await call(url, passes.full, '/api/tools/_batch', { calls: [{ name: read.name, args: argsFor('read') }] });
    assert(batch.data.ok === true && Array.isArray(batch.data.result?.results),
      '§4: read-only batch failed');
    const refused = await call(url, passes.full, '/api/tools/_batch',
      { calls: [{ name: write.name, args: { confirm: true } }] });
    assert(refused.status >= 400 && errorShape(refused.data), '§4: batch must refuse writes');
    const tooMany = await call(url, passes.full, '/api/tools/_batch',
      { calls: Array.from({ length: 11 }, () => ({ name: read.name })) });
    assert(tooMany.status >= 400 && errorShape(tooMany.data, 'invalid_args'),
      '§4: batch must reject more than 10 calls');
  }, { needs: ['full'], requiresManifest: true });
  await probe('reads', async () => {
    const { read } = selection();
    const path = '/api/tools/' + encodeURIComponent(read.name);
    const summary = await call(url, passes.full, path, { ...argsFor('read'), detail: 'summary', fields: field });
    assert(summary.data.ok && Object.hasOwn(summary.data.result || {}, field) && Object.keys(summary.data.result).every((x) => x === field),
      '§7: fields projection failed');
    const largeName = fixture?.largeRead.name || read.name;
    assert(catalog.some(t => t.name === largeName && !t.writes), '§7: large read must be an advertised read');
    const long = await call(url, passes.full, '/api/tools/' + encodeURIComponent(largeName),
      { ...argsFor('largeRead'), detail: 'full' });
    const recovered = await recoverResult(call, url, passes.full, long);
    assert(Buffer.byteLength(recovered) > 8192, '§7: result handle must recover the complete >8KB fixture');
    if (available(passes, 'readOnly')) {
      const other = await call(url, passes.readOnly,
        '/api/results/' + encodeURIComponent(long.data.handle));
      assert(other.status === 404, '§7: result handle leaked to another pass');
    }
  }, { needs: ['full'], requiresManifest: true });
  await probe('writes', async () => {
    const { read, write, guarded } = selection();
    const path = '/api/tools/' + encodeURIComponent(write.name);
    const readPath = '/api/tools/' + encodeURIComponent(read.name);
    const before = await call(url, passes.full, readPath, { ...argsFor('read'), detail: 'summary', fields: field });
    const dry = await call(url, passes.full, path, { ...argsFor('write'), dryRun: true, confirm: true, [valueArgument]: 'preview' });
    const after = await call(url, passes.full, readPath, { ...argsFor('read'), detail: 'summary', fields: field });
    assert(dry.data.ok && dry.data.result?.done === false &&
      Object.hasOwn(before.data.result || {}, field) && before.data.result[field] === after.data.result?.[field],
      '§6: dryRun must not change state');
    const unconfirmed = await call(url, passes.full,
      '/api/tools/' + encodeURIComponent(guarded.name), { ...argsFor('guarded'), [valueArgument]: 'unconfirmed' });
    assert(unconfirmed.data.result?.needsConfirmation === true &&
      unconfirmed.data.result?.done === false, '§6: guarded write needs confirmation');
    const done = await call(url, passes.full, path, { ...argsFor('write'), confirm: true, [valueArgument]: 'committed' });
    const check = await call(url, passes.full, readPath, { ...argsFor('read'), fields: field });
    assert(done.data.result?.confirmed === true && done.data.result?.logged?.id &&
      check.data.result?.[field] === 'committed', '§6: write must read back and log its change');
  }, { needs: ['full'], requiresManifest: true });
  await probe('passes', async () => {
    const missing = await call(url, null, '/api/whoami');
    assert(missing.status === 401 && errorShape(missing.data, 'permission'),
      '§2: HTTPS must reject missing bearer pass');
  });
  await probe('passes.read_only', async () => {
    const { write } = selection();
    const blocked = await call(url, passes.readOnly,
      '/api/tools/' + encodeURIComponent(write.name), { ...argsFor('write'), [valueArgument]: 'forbidden', confirm: true });
    assert(blocked.status >= 400 && errorShape(blocked.data, 'refused_by_guard'),
      '§2: read-only pass must refuse all writes');
  }, { needs: ['readOnly'], requiresManifest: true });
  for (const [role, code] of [['expired', 'pass_expired'], ['revoked', 'pass_revoked']]) {
    await probe('passes.' + role, async () => {
      const blocked = await call(url, passes[role], '/api/whoami');
      assert(blocked.status === 401 && errorShape(blocked.data, code),
        '§2: ' + role + ' pass must be refused');
    }, { needs: [role] });
  }
  await probe('safety', async () => {
    const { read } = selection();
    const response = await call(url, passes.full,
      '/api/tools/' + encodeURIComponent(read.name), { ...argsFor('read'), detail: 'summary' });
    assert(!tokenPattern.test(JSON.stringify(response.data)), '§7: response contains a secret-shaped value');
    tokenPattern.lastIndex = 0;
    const bad = await call(url, passes.full, '/api/tools/definitely_not_a_tool');
    assert(bad.status === 404 && errorShape(bad.data, 'not_found'),
      '§7: errors require what, cause, todo, technical and code');
  }, { needs: ['full'], requiresManifest: true });
  await probe('budget', async () => {
    const small = await call(url, passes.full, '/api/tools?listing=compact&limit=100');
    assert(small.data.ok === true &&
      JSON.stringify(small.data).length / 4 < 5000, '§5: compact listing exceeds 5000 tokens');
  }, { needs: ['full'], requiresManifest: true });
  if (oauth) await probe('oauth.refresh_settings',
    async () => verifyRefreshSettings(oauth), { requiresManifest: true });
  else checks.push({ name: 'oauth.refresh_settings', ok: false, skipped: true,
    message: 'Skipped: no local server-owned OAuth fixture adapter' });
  if (instances) await probe('limits.two_instance',
    async () => verifyTwoInstanceRateLimit(instances), { requiresManifest: true });
  else checks.push({ name: 'limits.two_instance', ok: false, skipped: true,
    message: 'Skipped: no two independent processes sharing a throwaway database' });
  return { ok: checks.length > 0 && checks.every((x) => x.ok && !x.skipped), checks };
}
