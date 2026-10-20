import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createGameServer, loadPersonalVoiceConfig } from '../server.mjs';

test('voice needs both explicit credentials and a valid agent identifier', async () => {
  const missing = { configured: false, reason: 'PERSONAL_AGENT_NOT_CONFIGURED' };
  for (const environment of [{}, { ELEVENLABS_API_KEY: 'test-key' }, { ELEVENLABS_AGENT_ID: 'test-agent' },
    { ELEVENLABS_API_KEY: '  ', ELEVENLABS_AGENT_ID: 'test-agent' },
    { ELEVENLABS_API_KEY: 'test-key\nheader', ELEVENLABS_AGENT_ID: 'test-agent' }]) {
    assert.deepEqual(await loadPersonalVoiceConfig(undefined, environment), missing);
  }
  for (const agentId of ['x', '../private-agent', 'agent?query=true', 'agent\nheader', 'a'.repeat(161)]) {
    assert.deepEqual(await loadPersonalVoiceConfig(undefined, { ELEVENLABS_API_KEY: 'test-key', ELEVENLABS_AGENT_ID: agentId }), missing);
  }
  assert.deepEqual(await loadPersonalVoiceConfig(undefined, { ELEVENLABS_API_KEY: ' test-key ', ELEVENLABS_AGENT_ID: 'agent-test_123' }),
    { configured: true, key: 'test-key', agentId: 'agent-test_123' });
});

test('configured status is local and secret-free; a requested token alone reaches the mock provider', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'guild-env-'));
  const key = 'SECRET_CANARY_SERVER_ENV_KEY';
  let calls = 0;
  await writeFile(path.join(root, 'index.html'), '<title>test</title>');
  const app = await createGameServer({ root, environment: { ELEVENLABS_API_KEY: key, ELEVENLABS_AGENT_ID: 'agent-test_123' },
    speechService: { status: () => ({ ready: false }), close: async () => {} },
    fetcher: async (url, request) => {
      calls++;
      assert.equal(new URL(url).searchParams.get('agent_id'), 'agent-test_123');
      assert.equal(request.headers['xi-api-key'], key);
      return Response.json({ token: 'mock-conversation-token' });
    } });
  try {
    const { url } = await app.listen(0);
    const status = await (await fetch(`${url}/api/voice/status`)).text();
    assert.equal(JSON.parse(status).configured, true);
    assert.equal(status.includes(key), false);
    assert.equal(status.includes('agent-test_123'), false);
    assert.equal(calls, 0);
    const session = await fetch(`${url}/api/session`);
    const cookie = session.headers.get('set-cookie').split(';')[0];
    const { csrf } = await session.json();
    const token = await fetch(`${url}/api/voice/token`, { method: 'POST', headers: { Origin: url, Cookie: cookie, 'X-Guild-CSRF': csrf, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(token.status, 200);
    const body = await token.text();
    assert.equal(JSON.parse(body).conversationToken, 'mock-conversation-token');
    assert.equal(body.includes(key), false);
    assert.equal(body.includes('agent-test_123'), false);
    assert.equal(calls, 1);
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
