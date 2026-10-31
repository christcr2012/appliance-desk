import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const secret = () => 'rtc_pass_' + randomBytes(32).toString('base64url');
const error = (code, status = 400) => ({
  status, body: { ok: false, error: { code, what: code.replaceAll('_', ' '),
    cause: code, todo: 'Check your authorization and request.', technical: '' } }
});
const tool = (name, writes = false, extra = {}) => ({
  name, description: writes ? 'Update a test record' : 'Read a test record',
  inputSchema: { type: 'object', properties: { detail: { type: 'string' },
    fields: { type: 'array', items: { type: 'string' } },
    dryRun: { type: 'boolean' }, confirm: { type: 'boolean' } } },
  area: 'testing', profiles: ['read_only', 'everyday', 'full'],
  writes, money: false, destructive: false, audience: ['builder', 'owner', 'operator'],
  annotations: { readOnlyHint: !writes, destructiveHint: false,
    idempotentHint: true, openWorldHint: false }, ...extra
});
const deliver = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};
const readBody = async (req) => {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 100_000) throw new Error('oversize request');
  }
  return text ? JSON.parse(text) : {};
};
const project = (value, fields) => fields?.length ? Object.fromEntries(
  (typeof fields === 'string' ? fields.split(',') : fields).filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]])) : value;

export async function startFakeServer({ prefix = 'fake', faults = [], passes: sharedPasses, rateLimit } = {}) {
  const bad = new Set(faults);
  const passes = sharedPasses || { full: secret(), readOnly: secret(), expired: secret(), revoked: secret() };
  const oauthAccess = randomBytes(32).toString('base64url');
  const oauthRefresh = randomBytes(32).toString('base64url');
  const oauthTokens = new Map([[oauthAccess, { profile: 'read_only', listing: 'compact',
    areas: ['testing'], mode: 'test', account: 'sandbox' }]]);
  const refreshTokens = new Map([[oauthRefresh, oauthAccess]]);
  const localCounts = new Map();
  const state = { value: 'original', changes: [], handles: new Map() };
  const names = [prefix + '_read_record', prefix + '_write_record',
    prefix + '_delete_record', prefix + '_send_money'];
  if (bad.has('unprefixed-tool')) names[0] = 'unprefixed_read_record';
  const tools = [tool(names[0]), tool(names[1], true),
    tool(names[2], true, { destructive: true, annotations: {
      readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } }),
    tool(names[3], true, { money: true, description: 'MOVES MONEY: Move fake currency' })];
  const byName = new Map(tools.map((entry) => [entry.name, entry]));
  function reply(body, pass, res, status = 200) {
    if (!body.ok || JSON.stringify(body).length <= 8192 || bad.has('oversize-without-handle')) {
      return deliver(res, status, body);
    }
    const handle = randomBytes(16).toString('hex');
    state.handles.set(handle, { pass, body, expires: Date.now() + 86_400_000 });
    return deliver(res, 200, { ok: true, result: { summary: 'Large fake result', count: 1 },
      handle, count: 1, summary: 'Large fake result' });
  }
  async function invoke(name, args, pass) {
    const entry = byName.get(name);
    if (!entry) return error('not_found', 404);
    if (entry.writes && pass === passes.readOnly && !bad.has('read-only-pass-can-write'))
      return error('refused_by_guard', 403);
    if (!entry.writes) {
      const record = { value: state.value,
        payload: args.detail === 'full' ? 'X'.repeat(9000) : 'short' };
      if (bad.has('key-in-result')) record.token = 'sk' + '_live_' + 'A'.repeat(24);
      return { status: 200, body: { ok: true, result: project(record, args.fields) } };
    }
    const preview = args.dryRun === true && !bad.has('write-ignores-dry-run');
    const needsConfirmation = (entry.destructive || entry.money) && args.confirm !== true;
    if (preview || needsConfirmation) {
      state.changes.push({ preview: true, name });
      return { status: 200, body: { ok: true, result: { done: false,
        dryRun: preview, needsConfirmation, summary: 'Would change test record' } } };
    }
    state.value = name.endsWith('delete_record') ? 'deleted' : String(args.value ?? 'updated');
    const id = 'fake-' + (state.changes.length + 1);
    state.changes.push({ id, name, preview: false, after: state.value });
    return { status: 200, body: { ok: true, result: { done: true, confirmed: true,
      value: state.value, logged: { id } } } };
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'POST' && url.pathname === '/api/oauth/token') {
        let data = '';
        for await (const chunk of req) data += chunk;
        const params = new URLSearchParams(data);
        const source = refreshTokens.get(params.get('refresh_token'));
        if (params.get('grant_type') !== 'refresh_token' || !source)
          return deliver(res, 400, error('invalid_args').body);
        refreshTokens.delete(params.get('refresh_token'));
        const access = randomBytes(32).toString('base64url');
        const refresh = randomBytes(32).toString('base64url');
        const settings = oauthTokens.get(source);
        oauthTokens.set(access, bad.has('refresh-drops-settings') ?
          { profile: 'full', listing: 'catalog', areas: [], mode: 'live', account: 'sandbox' } :
          structuredClone(settings));
        refreshTokens.set(refresh, access);
        return deliver(res, 200, { access_token: access, refresh_token: refresh,
          token_type: 'Bearer', expires_in: 3600 });
      }
      if (req.method === 'GET' && url.pathname === '/__rtc_test/oauth/settings') {
        const token = req.headers.authorization?.replace(/^Bearer /, '');
        const settings = oauthTokens.get(token);
        return settings ? deliver(res, 200, { ok: true, result: settings }) :
          deliver(res, 401, error('permission', 401).body);
      }
      if (req.method === 'GET' && url.pathname === '/api/contract') {
        if (bad.has('no-manifest')) return deliver(res, 404, error('not_found', 404).body);
        return deliver(res, 200, { rtc: 1, server: 'reference-fake', prefix,
          version: '1.0.0', areas: ['testing'], counts: { tools: 4, writes: 3, money: 1 },
          profiles: ['read_only', 'everyday', 'full'], listingModes: ['compact', 'catalog'],
          modes: ['test'], devTools: false });
      }
      if (req.method === 'GET' && url.pathname === '/api/openapi.json') {
        return deliver(res, 200, { openapi: '3.1.0', info: { title: 'RTC fake', version: '1' },
          paths: { '/api/tools': { get: {} }, '/api/whoami': { get: {} } } });
      }
      const auth = req.headers.authorization;
      const pass = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
      if (pass === passes.expired) {
        const e = error('pass_expired', 401); return deliver(res, e.status, e.body);
      }
      if (pass === passes.revoked) {
        const e = error('pass_revoked', 401); return deliver(res, e.status, e.body);
      }
      if (pass !== passes.full && pass !== passes.readOnly) {
        const e = error('permission', 401); return deliver(res, e.status, e.body);
      }
      if (rateLimit && req.method === 'GET' && url.pathname === '/api/whoami') {
        const count = rateLimit.increment ? await rateLimit.increment(pass) :
          (localCounts.set(pass, (localCounts.get(pass) || 0) + 1), localCounts.get(pass));
        if (count > rateLimit.max) return deliver(res, 429,
          error('rate_limited', 429).body, { 'retry-after': '60' });
      }
      if (req.method === 'GET' && url.pathname === '/api/whoami')
        return deliver(res, 200, { ok: true, result: { profile:
          pass === passes.full ? 'full' : 'read_only', mode: 'test' } });
      if (req.method === 'GET' && url.pathname === '/api/tools') {
        const list = url.searchParams.get('listing') === 'compact' ? tools.slice(0, 2) : tools;
        const q = url.searchParams.get('q')?.toLowerCase();
        return deliver(res, 200, { ok: true, result: { tools: list.filter((t) =>
          (!q || t.name.includes(q)) &&
          (!url.searchParams.has('area') || t.area === url.searchParams.get('area')) &&
          (!url.searchParams.has('audience') || t.audience.includes(url.searchParams.get('audience'))))
          .slice(0, Number(url.searchParams.get('limit') || 20)) } });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/results/')) {
        const item = state.handles.get(url.pathname.split('/').at(-1));
        if (!item || item.pass !== pass || item.expires < Date.now()) {
          const e = error('not_found', 404); return deliver(res, e.status, e.body);
        }
        return deliver(res, 200, item.body);
      }
      if (req.method === 'POST' && url.pathname === '/api/tools/_batch') {
        const data = await readBody(req);
        if (!Array.isArray(data.calls) || data.calls.length > 10)
          return deliver(res, 400, error('invalid_args').body);
        const results = [];
        for (const call of data.calls) {
          if (!byName.get(call.name) || byName.get(call.name).writes)
            return deliver(res, 403, error('refused_by_guard', 403).body);
          const result = await invoke(call.name, call.args || {}, pass);
          results.push(result.body.result);
        }
        return deliver(res, 200, { ok: true, result: { results } });
      }
      if (url.pathname.startsWith('/api/tools/')) {
        const name = decodeURIComponent(url.pathname.slice('/api/tools/'.length));
        const entry = byName.get(name);
        if (req.method === 'GET' && entry) return deliver(res, 200, { ok: true, result: entry });
        if (req.method === 'POST' && entry) {
          const args = await readBody(req);
          const outcome = await invoke(name, args, pass);
          return reply(outcome.body, pass, res, outcome.status);
        }
      }
      if (bad.has('bad-error-envelope')) return deliver(res, 404, { nope: true });
      const e = error('not_found', 404); return deliver(res, e.status, e.body);
    } catch {
      const e = error('invalid_args'); return deliver(res, e.status, e.body);
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const serverUrl = 'http://127.0.0.1:' + address.port;
  const oauth = {
    async inspect(token = oauthAccess) {
      const response = await fetch(serverUrl + '/__rtc_test/oauth/settings',
        { headers: { authorization: 'Bearer ' + token } });
      if (!response.ok) throw new Error('OAuth fixture inspection failed');
      return (await response.json()).result;
    },
    async refresh() {
      const response = await fetch(serverUrl + '/api/oauth/token', { method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: oauthRefresh }) });
      if (!response.ok) throw new Error('OAuth refresh request failed');
      return (await response.json()).access_token;
    }
  };
  return { url: serverUrl, passes, state, oauth,
    close: () => new Promise((resolve, reject) =>
      server.close((e) => e ? reject(e) : resolve())) };
}
