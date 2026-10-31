// Server-owned local fixture descriptions select REAL advertised tools. They
// supply inputs and expected state, never callbacks that can waive assertions.
export function fixtureOptions(input) {
  if (input === undefined) return null;
  const plain = x => x && typeof x === 'object' && !Array.isArray(x);
  if (!plain(input) || Object.keys(input).some(k => !['read', 'write', 'guarded', 'largeRead', 'field', 'valueArgument'].includes(k)))
    throw new TypeError('Invalid server-owned conformance fixture description');
  const out = {};
  for (const key of ['read', 'write', 'guarded', 'largeRead']) {
    const tool = input[key];
    if (!plain(tool) || Object.keys(tool).some(k => !['name', 'args'].includes(k)) ||
        typeof tool.name !== 'string' || !/^[a-z][a-z0-9_]{1,159}$/.test(tool.name) ||
        !plain(tool.args) || Buffer.byteLength(JSON.stringify(tool.args)) > 65536 ||
        ['confirm', 'dryRun', 'detail', 'fields'].some(k => Object.hasOwn(tool.args, k)))
      throw new TypeError('Each conformance fixture needs a named tool and bounded object arguments');
    out[key] = { name: tool.name, args: structuredClone(tool.args) };
  }
  for (const key of ['field', 'valueArgument']) {
    if (typeof input[key] !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(input[key]) ||
        ['constructor', 'prototype', '__proto__'].includes(input[key]))
      throw new TypeError('Conformance state selectors must be simple safe property names');
    out[key] = input[key];
  }
  return out;
}

export async function recoverResult(call, url, pass, initial) {
  const handle = initial.data?.handle;
  if (initial.status !== 200 || initial.data?.ok !== true || typeof handle !== 'string' || !handle || JSON.stringify(initial.data).length > 8192)
    throw new Error('§7: >8 KB result must return a bounded handle envelope');
  let path = '/api/results/' + encodeURIComponent(handle), content = '', page = 1, bytes;
  for (let count = 0; count < 256; count++) {
    const r = await call(url, pass, path);
    const value = r.data?.result;
    if (r.status !== 200 || !r.data.ok || !value || typeof value !== 'object')
      throw new Error('§7: owned result cannot be recovered');
    // Legacy inline payloads are permitted only when the server actually uses
    // them. Numbered pages must be contiguous, byte-bounded and complete.
    if (count === 0 && typeof value.payload === 'string') return value.payload;
    if (value.page !== page || !Number.isSafeInteger(value.pages) || value.pages < page ||
        !Number.isSafeInteger(value.bytes) || value.bytes < 0 ||
        typeof value.content !== 'string' || Buffer.byteLength(value.content) > 4096 ||
        value.next !== (page < value.pages ? page + 1 : null) ||
        (bytes !== undefined && value.bytes !== bytes))
      throw new Error('§7: malformed, oversized or discontinuous result page');
    bytes = value.bytes;
    content += value.content;
    if (Buffer.byteLength(content) > 1048576) throw new Error('§7: conformance recovery exceeds 1 MiB');
    if (value.next === null) {
      if (Buffer.byteLength(content) !== bytes) throw new Error('§7: recovered result byte count disagrees');
      return content;
    }
    page = value.next;
    path = '/api/results/' + encodeURIComponent(handle) + '?page=' + page;
  }
  throw new Error('§7: conformance recovery exceeds 256 pages');
}
