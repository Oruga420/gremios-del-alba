import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createGameServer, publicPath, loadPersonalVoiceConfig } from '../server.mjs';

async function setup(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'guild-server-'));
  await mkdir(path.join(root, 'src')); await mkdir(path.join(root, 'assets')); await mkdir(path.join(root, '.local'), { recursive: true });
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Juego</title>'); await writeFile(path.join(root, 'src', 'app.js'), 'export const safe=true;'); await writeFile(path.join(root, '.env'), 'SECRET_CANARY_NEVER_SERVE'); await writeFile(path.join(root, 'server.mjs'), 'SECRET_CANARY_SERVER');
  const logs = []; const app = await createGameServer({ root, environment: {}, ...options, log: (code) => logs.push(code) }); const address = await app.listen(0);
  return { root, app, logs, ...address, async cleanup() { await app.close(); await rm(root, { recursive: true, force: true }); } };
}
async function localSession(h) { const response = await fetch(`${h.url}/api/session`); return { cookie: response.headers.get('set-cookie').split(';')[0], csrf: (await response.json()).csrf }; }
function post(h, s, body = {}, headers = {}) { return fetch(`${h.url}/api/voice/token`, { method: 'POST', headers: { Origin: h.url, Cookie: s.cookie, 'X-Guild-CSRF': s.csrf, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); }
test('static allowlist denies dotfiles, encodings, server, keys and traversal', async () => {
  const h = await setup(); try {
    assert.equal((await fetch(h.url)).status, 200); const source = await fetch(`${h.url}/src/app.js`); assert.equal(source.status, 200); assert.match(source.headers.get('x-guild-source-hash'), /^[a-f0-9]{64}$/u);
    for (const route of ['/.env', '/server.mjs', '/scripts/memory.py', '/.git/config', '/keys/key.txt', '/%2eenv', '/%252eenv', '/assets/%2e%2e/server.mjs', '/src%5c..%5c.env', '/.local/voice/config.json']) { const response = await fetch(`${h.url}${route}`); assert.equal(response.status, 404, route); assert.equal((await response.text()).includes('SECRET_CANARY'), false); }
    assert.equal(publicPath('/src/../../.env'), null); assert.equal(publicPath('/src/%252e%252e/.env'), null);
  } finally { await h.cleanup(); }
});
test('canonical realpath rejects public junction escape and in-root secret link', async () => {
  const h = await setup(); const outside = await mkdtemp(path.join(os.tmpdir(), 'guild-private-'));
  try { await writeFile(path.join(outside, 'secret.js'), 'SECRET_CANARY_OUTSIDE'); await symlink(outside, path.join(h.root, 'src', 'escape'), 'junction'); await symlink(path.join(h.root, '.local'), path.join(h.root, 'src', 'local'), 'junction'); await writeFile(path.join(h.root, '.local', 'secret.js'), 'SECRET_CANARY_LOCAL'); for (const route of ['/src/escape/secret.js', '/src/local/secret.js']) assert.equal((await fetch(`${h.url}${route}`)).status, 404); }
  finally { await h.cleanup(); await rm(outside, { recursive: true, force: true }); }
});
test('Host and Origin poisoning is rejected before routing', async () => {
  const h = await setup(); try {
    assert.equal((await fetch(`${h.url}/api/session`, { headers: { Origin: 'https://evil.example' } })).status, 403);
    const status = await new Promise((resolve, reject) => { const request = http.get(`${h.url}/api/health`, { headers: { Host: 'attacker.example' } }, (response) => { response.resume(); resolve(response.statusCode); }); request.on('error', reject); }); assert.equal(status, 403);
    const health = await (await fetch(`${h.url}/health`)).json(); assert.equal(health.project, 'gremios-del-alba'); assert.equal(health.pid, process.pid); assert.equal(health.root, h.root); assert.match(health.serverSha256, /^[a-f0-9]{64}$/u);
  } finally { await h.cleanup(); }
});
test('token route requires session, exact Origin and CSRF and reports missing config503', async () => {
  const h = await setup(); try {
    assert.equal((await post(h, {})).status, 401); const s = await localSession(h);
    assert.equal((await post(h, s, {}, { 'X-Guild-CSRF': 'bad' })).status, 403); assert.equal((await post(h, s, {}, { Origin: 'https://evil.example' })).status, 403);
    const result = await post(h, s); assert.equal(result.status, 503); assert.equal(result.headers.get('cache-control'), 'no-store'); assert.equal((await result.json()).code, 'PERSONAL_AGENT_NOT_CONFIGURED');
  } finally { await h.cleanup(); }
});
test('vendor errors sanitize secret values and consume persistent atomic grants', async () => {
  let calls = 0; const h = await setup({ maxGrants: 2, getVoiceConfig: async () => ({ configured: true, key: 'SECRET_CANARY_VENDOR_KEY', agentId: 'private-test' }), fetcher: async () => { calls++; throw new Error('SECRET_CANARY_VENDOR_KEY'); } });
  try {
    const s = await localSession(h); const results = await Promise.all([post(h, s), post(h, s), post(h, s), post(h, s)]); assert.equal(results.filter((r) => r.status === 502).length, 2); assert.equal(results.filter((r) => r.status === 429).length, 2); assert.equal(calls, 2);
    for (const result of results) assert.equal((await result.text()).includes('SECRET_CANARY'), false); assert.equal(JSON.stringify(h.logs).includes('SECRET_CANARY'), false);
    await h.app.close(); const app = await createGameServer({ root: h.root, maxGrants: 2, getVoiceConfig: async () => ({ configured: true, key: 'x', agentId: 'test' }), fetcher: async () => { throw new Error(); } }); const address = await app.listen(0); try { const fresh = await localSession(address); assert.equal((await post(address, fresh)).status, 429); } finally { await app.close(); }
  } finally { await h.cleanup(); }
});
test('successful grants have no-store and one active lease released only by its session', async () => {
  const h = await setup({ getVoiceConfig: async () => ({ configured: true, key: 'SECRET_CANARY_KEY', agentId: 'test-agent' }), fetcher: async (_url, request) => { assert.equal(request.headers['xi-api-key'], 'SECRET_CANARY_KEY'); return Response.json({ token: 'test-conversation-token', conversation_id: 'conversation-1' }); } });
  try {
    const s = await localSession(h); const result = await post(h, s); assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store'); const value = await result.json(); assert.equal(value.conversationToken, 'test-conversation-token'); assert.equal(JSON.stringify(value).includes('SECRET_CANARY_KEY'), false); assert.equal((await post(h, s)).status, 409);
    await fetch(`${h.url}/api/voice/release`, { method: 'POST', headers: { Origin: h.url, Cookie: s.cookie, 'X-Guild-CSRF': s.csrf }, body: JSON.stringify({ leaseId: value.leaseId }) }); assert.equal((await post(h, s)).status, 200);
  } finally { await h.cleanup(); }
});
test('legacy keySource config cannot enable voice without explicit server environment', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'guild-config-')); try { await mkdir(path.join(root, '.local', 'voice'), { recursive: true }); await writeFile(path.join(root, '.local', 'voice', 'config.json'), JSON.stringify({ personal: true, keySource: 'unapproved-source/keys.txt', agentId: 'agent-test', keyCandidateIndex: 1 })); assert.equal((await loadPersonalVoiceConfig(root, {})).reason, 'PERSONAL_AGENT_NOT_CONFIGURED'); } finally { await rm(root, { recursive: true, force: true }); }
});

test('opening another tab preserves the active tab CSRF and call release', async () => {
  const h = await setup({ getVoiceConfig: async () => ({ configured: true, key: 'test', agentId: 'test' }), fetcher: async () => Response.json({ token: 'test-conversation-token' }) });
  try {
    const first = await localSession(h);
    const lease = await (await post(h, first)).json();
    const second = await (await fetch(`${h.url}/api/session`, { headers: { Cookie: first.cookie } })).json();
    assert.equal(second.csrf, first.csrf);
    const release = await fetch(`${h.url}/api/voice/release`, { method: 'POST', headers: { Origin: h.url, Cookie: first.cookie, 'X-Guild-CSRF': first.csrf }, body: JSON.stringify({ leaseId: lease.leaseId }) });
    assert.equal(release.status, 200);
    assert.equal((await post(h, first)).status, 200);
    const stranger = await localSession(h);
    assert.notEqual(stranger.csrf, first.csrf);
    assert.equal((await post(h, stranger, {}, { 'X-Guild-CSRF': first.csrf })).status, 403);
  } finally { await h.cleanup(); }
});

test('health identifies loaded server source even when its file changes on disk', async () => {
  const h = await setup(); let isolated;
  try {
    await mkdir(path.join(h.root, 'scripts'));
    await copyFile(new URL('../scripts/local-speech-service.mjs', import.meta.url), path.join(h.root, 'scripts/local-speech-service.mjs'));
    const file = path.join(h.root, 'loaded-server.mjs');
    await copyFile(new URL('../server.mjs', import.meta.url), file);
    const initial = createHash('sha256').update(await readFile(file)).digest('hex');
    const module = await import(pathToFileURL(file));
    isolated = await module.createGameServer({ root: h.root, localDir: path.join(h.root, '.local', 'isolated'), speechService: { status: () => ({}), close: async () => {} } });
    const { url } = await isolated.listen(0);
    await writeFile(file, '// A newer disk revision which this process has not loaded\n');
    const health = await (await fetch(`${url}/api/health`)).json();
    assert.equal(health.serverSha256, initial);
  } finally { await isolated?.close(); await h.cleanup(); }
});

test('disconnecting during token creation releases the lease and aborts the provider request', async () => {
  let entered, release, onAbort;
  const started = new Promise(resolve => { entered = resolve; });
  const aborted = new Promise(resolve => { onAbort = resolve; });
  let calls = 0;
  const h = await setup({ getVoiceConfig: async () => ({ configured: true, key: 'test', agentId: 'test' }), fetcher: async (_url, options) => {
    if (++calls > 1) return Response.json({ token: 'test-next-conversation-token' });
    return new Promise((resolve, reject) => {
      release = () => resolve(Response.json({ token: 'test-abandoned-conversation-token' }));
      options.signal.addEventListener('abort', () => { onAbort(true); reject(options.signal.reason); }, { once: true });
      entered();
    });
  } });
  try {
    const s = await localSession(h);
    const req = http.request(`${h.url}/api/voice/token`, { method: 'POST', headers: { Origin: h.url, Cookie: s.cookie, 'X-Guild-CSRF': s.csrf, 'Content-Type': 'application/json' } });
    req.on('error', () => {}); req.end('{}'); await started; req.destroy();
    assert.equal(await Promise.race([aborted, new Promise(resolve => setTimeout(() => resolve(false), 500))]), true);
    assert.equal((await post(h, s)).status, 200);
  } finally { release?.(); await h.cleanup(); }
});

test('disconnecting during config lookup cannot reserve a new token lease', async () => {
  let entered, resolveConfig, closed;
  const lookup = new Promise(resolve => { entered = resolve; });
  const responseClosed = new Promise(resolve => { closed = resolve; });
  const config = { configured: true, key: 'test', agentId: 'test' }; let lookups = 0, calls = 0;
  const h = await setup({ getVoiceConfig: async () => ++lookups === 1 ? new Promise(resolve => { resolveConfig = resolve; entered(); }) : config,
    fetcher: async () => { calls++; return Response.json({ token: 'test-conversation-token' }); } });
  try {
    const s = await localSession(h);
    h.app.server.once('request', (_req, res) => res.once('close', closed));
    const req = http.request(`${h.url}/api/voice/token`, { method: 'POST', headers: { Origin: h.url, Cookie: s.cookie, 'X-Guild-CSRF': s.csrf } });
    req.on('error', () => {}); req.end('{}'); await lookup; req.destroy(); await responseClosed;
    resolveConfig(config);
    assert.equal((await post(h, s)).status, 200);
    assert.equal(calls, 1);
  } finally { resolveConfig?.(config); await h.cleanup(); }
});
