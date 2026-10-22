import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHandler } from '../server/cloud-voice.mjs';

const origin = 'https://guild.example';
const environment = { GUILD_PUBLIC_ORIGIN: origin, GUILD_SESSION_SECRET: 'test-only-session-secret-01234567890123456789', GUILD_DEPLOYMENT_PROTECTION: 'vercel-auth', ELEVENLABS_API_KEY: 'test-only-private-key', ELEVENLABS_AGENT_ID: 'test_agent' };
function request(handler, route, options = {}) {
  const headers = { host: 'guild.example', ...options.headers };
  if (options.method === 'POST') Object.assign(headers, { origin, 'content-type': 'application/json', ...options.headers });
  const req = { method: options.method || 'GET', url: `/api/guild?route=${encodeURIComponent(route)}`, headers, body: options.body ?? {} };
  return new Promise((resolve, reject) => {
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(value) { resolve({ status: this.status, headers: this.headers, body: JSON.parse(value) }); } };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}
async function session(handler) {
  const value = await request(handler, 'session');
  assert.equal(value.status, 200);
  return { cookie: value.headers['Set-Cookie'].split(';')[0], 'x-guild-csrf': value.body.csrf };
}
const make = (options = {}) => createCloudHandler({ environment, ...options });

test('cloud voice fails closed without protected deployment configuration', async () => {
  let calls = 0;
  const handler = make({ environment: { ...environment, GUILD_DEPLOYMENT_PROTECTION: '' }, fetcher: async () => calls++ });
  const result = await request(handler, 'voice/status');
  assert.equal(result.body.configured, false);
  assert.equal((await request(handler, 'session')).status, 503);
  assert.equal(calls, 0);
});
test('cloud health and speech expose no credentials, paths or false local availability', async () => {
  const handler = make();
  const health = await request(handler, 'health');
  assert.equal(health.body.runtime, 'vercel');
  assert.equal(health.headers['Cache-Control'], 'no-store');
  assert.equal(JSON.stringify(health).includes(environment.ELEVENLABS_API_KEY), false);
  assert.equal((await request(handler, 'speech/status')).body.ready, false);
  assert.equal((await request(handler, 'unknown')).status, 404);
});
test('cloud session survives a cold instance and keeps CSRF stable across tabs', async () => {
  const headers = await session(make());
  const second = make();
  const repeated = await request(second, 'session', { headers });
  assert.equal(repeated.body.csrf, headers['x-guild-csrf']);
  assert.match(repeated.headers['Set-Cookie'], /HttpOnly; Secure; SameSite=Strict/);
  assert.equal((await request(second, 'voice/release', { method: 'POST', headers })).status, 200);
});
test('cloud routes reject hostile origins, hosts and forged CSRF before vendor access', async () => {
  let calls = 0; const handler = make({ fetcher: async () => calls++ });
  const headers = await session(handler);
  assert.equal((await request(handler, 'session', { headers: { host: 'attacker.example' } })).status, 403);
  assert.equal((await request(handler, 'session', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await request(handler, 'voice/token', { method: 'POST' })).status, 401);
  for (const extra of [{ origin: 'https://attacker.example' }, { 'x-guild-csrf': 'forged' }, { cookie: headers.cookie + 'tampered' }]) {
    assert.equal((await request(handler, 'voice/token', { method: 'POST', headers: { ...headers, ...extra } })).status, extra.cookie ? 401 : 403);
  }
  assert.equal(calls, 0);
});
test('cloud cookie expiry and secret rotation reject old sessions', async () => {
  let clock = 1000; const handler = make({ now: () => clock }); const headers = await session(handler);
  clock += 28_800_001;
  assert.equal((await request(handler, 'voice/token', { method: 'POST', headers })).status, 401);
  const rotated = make({ environment: { ...environment, GUILD_SESSION_SECRET: 'different-test-only-012345678901234567890123456' } });
  assert.equal((await request(rotated, 'voice/token', { method: 'POST', headers })).status, 401);
});
test('cloud token proxy uses personal server environment, validates body and permits only own lease release', async () => {
  const calls = []; const handler = make({ fetcher: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ token: 'test-conversation-token', conversation_id: 'test-conversation' }) }; } });
  const headers = await session(handler);
  assert.equal((await request(handler, 'voice/token', { method: 'POST', headers, body: '{broken' })).status, 400);
  assert.equal((await request(handler, 'voice/token', { method: 'POST', headers, body: 'x'.repeat(8193) })).status, 413);
  assert.equal(calls.length, 0);
  const grant = await request(handler, 'voice/token', { method: 'POST', headers });
  assert.equal(grant.status, 200); assert.equal(grant.body.conversationToken, 'test-conversation-token');
  assert.equal(calls[0].options.headers['xi-api-key'], environment.ELEVENLABS_API_KEY);
  assert.match(calls[0].url, /agent_id=test_agent$/);
  assert.equal((await request(handler, 'voice/token', { method: 'POST', headers })).status, 409);
  const other = await session(handler);
  await request(handler, 'voice/release', { method: 'POST', headers: other, body: { leaseId: grant.body.leaseId } });
  assert.equal((await request(handler, 'voice/token', { method: 'POST', headers })).status, 409);
  await request(handler, 'voice/release', { method: 'POST', headers, body: { leaseId: grant.body.leaseId } });
  assert.equal((await request(handler, 'voice/token', { method: 'POST', headers })).status, 200);
});
test('cloud upstream failures are redacted, release lease and respect per-instance issuance limit', async () => {
  const handler = make({ maxGrants: 2, fetcher: async () => { throw new Error('upstream private diagnostic'); } });
  const headers = await session(handler);
  for (let i = 0; i < 2; i++) {
    const value = await request(handler, 'voice/token', { method: 'POST', headers });
    assert.equal(value.status, 502); assert.equal(JSON.stringify(value).includes('private diagnostic'), false);
  }
  assert.equal((await request(handler, 'voice/token', { method: 'POST', headers })).status, 429);
});
