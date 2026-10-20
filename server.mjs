import http from 'node:http';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createLocalSpeechService, SPEECH_LIMITS } from './scripts/local-speech-service.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HASH = (value) => createHash('sha256').update(value).digest('hex');
// Identity of the loaded module, not a newer file edited while this process runs.
const SERVER_SOURCE_HASH = HASH(await readFile(fileURLToPath(import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4' };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const within = (root, target) => { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };

export function publicPath(requestPath) {
  let decoded = requestPath;
  try {
    for (let i = 0; i < 4; i++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; }
  } catch { return null; }
  if (!decoded.startsWith('/') || /[\\\0:]/u.test(decoded) || /%[0-9a-f]{2}/iu.test(decoded)) return null;
  const parts = decoded.split('/').filter(Boolean);
  if (parts.some((part) => part.startsWith('.') || /^(?:keys?|config|server|scripts|node_modules)$/iu.test(part))) return null;
  const relative = parts.join('/') || 'index.html';
  if (['index.html', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'assets/LICENSE.md', 'assets/CC-BY-4.0.txt', 'assets/vendor/elevenlabs-client.LICENSE', 'assets/vendor/livekit-client.LICENSE', 'assets/vendor/livekit-client.NOTICE'].includes(relative)) return relative;
  const ext = path.extname(relative).toLowerCase();
  if (relative.startsWith('src/') && ['.js', '.css', '.json'].includes(ext)) return relative;
  if (relative.startsWith('assets/') && ['.json', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.woff2', '.mp3', '.wav', '.mp4', '.js'].includes(ext)) return relative;
  return null;
}

export async function loadPersonalVoiceConfig(_root = ROOT, environment = process.env) {
  // Credentials are opt-in server environment values. Never discover local key files.
  const key = environment.ELEVENLABS_API_KEY;
  const agentId = environment.ELEVENLABS_AGENT_ID;
  if (typeof key !== 'string' || !key.trim() || /[\r\n]/u.test(key) ||
      typeof agentId !== 'string' || !/^[a-zA-Z0-9_-]{5,160}$/u.test(agentId)) {
    return { configured: false, reason: 'PERSONAL_AGENT_NOT_CONFIGURED' };
  }
  return { configured: true, key: key.trim(), agentId };
}

export async function createGameServer(options = {}) {
  const root = await realpath(options.root || ROOT);
  const localDir = options.localDir || path.join(root, '.local', 'server');
  await mkdir(localDir, { recursive: true });
  const database = new DatabaseSync(path.join(localDir, 'voice-grants.sqlite'));
  database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS grants (id INTEGER PRIMARY KEY, session TEXT NOT NULL, created INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS grants_created ON grants(created); CREATE TABLE IF NOT EXISTS call_leases (id TEXT PRIMARY KEY, session TEXT NOT NULL, expires INTEGER NOT NULL);');
  database.exec('CREATE TABLE IF NOT EXISTS speech_grants (id INTEGER PRIMARY KEY, session TEXT NOT NULL, created INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS speech_grants_created ON speech_grants(created);');
  const speech = options.speechService || createLocalSpeechService(root, options.environment || process.env);
  let speechBusy = false;
  const now = options.now || Date.now;
  const fetcher = options.fetcher || fetch;
  const getVoice = options.getVoiceConfig || (() => loadPersonalVoiceConfig(root, options.environment || process.env));
  const maxGrants = options.maxGrants ?? 20;
  const grantWindow = options.grantWindow ?? 600_000;
  const hardCapMs = options.hardCapMs ?? 300_000;
  const logs = options.log || ((code) => process.stderr.write(`[server] ${code}\n`));
  let port;
  let closed = false;

  const safeHeaders = {
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'microphone=(self), tools=(self), camera=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.elevenlabs.io wss://api.elevenlabs.io wss://*.elevenlabs.io https://*.livekit.cloud wss://*.livekit.cloud; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'"
  };
  function reply(res, status, data, extra = {}) {
    res.writeHead(status, { ...safeHeaders, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
    res.end(JSON.stringify(data));
  }
  function trusted(req) {
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(String(req.headers.host || '').toLowerCase())) return false;
    if (req.headers.origin && !hosts.map((host) => `http://${host}`).includes(req.headers.origin)) return false;
    return !['cross-site'].includes(req.headers['sec-fetch-site']);
  }
  function session(req) {
    const id = String(req.headers.cookie || '').match(/(?:^|;\s*)guild_session=([a-f0-9]{64})(?:;|$)/u)?.[1];
    if (!id) return null;
    const found = database.prepare('SELECT * FROM sessions WHERE id=? AND expires>?').get(HASH(id), now());
    return found ? { ...found, cookieId: id } : null;
  }
  async function body(req) {
    let data = '';
    for await (const chunk of req) { data += chunk; if (data.length > 8192) throw new Error('BODY_LIMIT'); }
    try { return data ? JSON.parse(data) : {}; } catch { throw new Error('BODY_JSON'); }
  }
  function audioBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0, done = false; const chunks = [];
      const finish = (code, value) => { if (done) return; done = true; clearTimeout(timer); req.removeListener('data', data); req.removeListener('end', ended); req.removeListener('error', failed); req.removeListener('aborted', failed); if (code) { req.once('error', () => {}); req.resume(); reject(Object.assign(new Error(code), { code })); } else resolve(value); };
      const data = (chunk) => { size += chunk.length; if (size > SPEECH_LIMITS.bytes) finish('AUDIO_BODY_LIMIT'); else chunks.push(chunk); };
      const ended = () => finish(null, Buffer.concat(chunks));
      const failed = () => finish('ABORTED');
      const timer = setTimeout(() => finish('AUDIO_UPLOAD_TIMEOUT'), 5000);
      req.on('data', data); req.once('end', ended); req.once('error', failed); req.once('aborted', failed);
    });
  }
  function reserveSpeech(current) {
    if (speechBusy) return 'ASR_BUSY';
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('DELETE FROM speech_grants WHERE created<=?').run(now() - SPEECH_LIMITS.windowMs);
      const globalCount = database.prepare('SELECT count(*) AS count FROM speech_grants').get().count;
      const sessionCount = database.prepare('SELECT count(*) AS count FROM speech_grants WHERE session=?').get(current.id).count;
      if (globalCount >= SPEECH_LIMITS.global || sessionCount >= SPEECH_LIMITS.perSession) { database.exec('ROLLBACK'); return 'SPEECH_RATE_LIMIT'; }
      database.prepare('INSERT INTO speech_grants(session,created) VALUES(?,?)').run(current.id, now()); database.exec('COMMIT'); speechBusy = true; return null;
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  function authorize(req, res) {
    const current = session(req);
    if (!current) { reply(res, 401, { ok: false, code: 'SESSION_REQUIRED', message: 'Abre el juego antes de iniciar la llamada.' }); return null; }
    if (req.headers.origin !== `http://${req.headers.host}` || !same(HASH(String(req.headers['x-guild-csrf'] || '')), current.csrf)) { reply(res, 403, { ok: false, code: 'CSRF_REJECTED', message: 'La solicitud de voz no pertenece a esta sesión.' }); return null; }
    return current;
  }
  function reserveGrant(current) {
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('DELETE FROM grants WHERE created<=?').run(now() - grantWindow);
      database.prepare('DELETE FROM call_leases WHERE expires<=?').run(now());
      const total = database.prepare('SELECT count(*) AS count FROM grants').get().count;
      const perSession = database.prepare('SELECT count(*) AS count FROM grants WHERE session=?').get(current.id).count;
      if (total >= maxGrants || perSession >= maxGrants) { database.exec('ROLLBACK'); return { code: 'GRANT_LIMIT', status: 429 }; }
      if (database.prepare('SELECT count(*) AS count FROM call_leases').get().count > 0) { database.exec('ROLLBACK'); return { code: 'CALL_ALREADY_ACTIVE', status: 409 }; }
      const leaseId = randomBytes(24).toString('hex');
      database.prepare('INSERT INTO grants(session,created) VALUES(?,?)').run(current.id, now());
      database.prepare('INSERT INTO call_leases(id,session,expires) VALUES(?,?,?)').run(leaseId, current.id, now() + hardCapMs);
      database.exec('COMMIT');
      return { leaseId };
    } catch (error) { database.exec('ROLLBACK'); throw error; }
  }
  const server = http.createServer(async (req, res) => {
    try {
      if (!trusted(req)) return reply(res, 403, { ok: false, code: 'ORIGIN_REJECTED' });
      const rawPath = String(req.url || '/').split('?')[0];
      if (rawPath.startsWith('/api/') || rawPath === '/health') {
        if (['/api/health', '/health'].includes(rawPath) && req.method === 'GET') {
          const entry = await readFile(path.join(root, 'index.html')).catch(() => Buffer.from(''));
          const serverSha256 = SERVER_SOURCE_HASH;
          return reply(res, 200, { ok: true, project: 'gremios-del-alba', name: 'gremios-del-alba', pid: process.pid, root, entryHash: HASH(entry), serverHash: serverSha256, serverSha256, loopback: true, speech: speech.status() });
        }
        if (rawPath === '/api/session' && req.method === 'GET') {
          const id = session(req)?.cookieId || randomBytes(32).toString('hex');
          // The HttpOnly random session cookie is the secret seed. Returning the
          // same derived token keeps another tab from invalidating active calls.
          const csrf = createHmac('sha256', id).update('guild-csrf-v1').digest('hex');
          database.prepare('INSERT OR REPLACE INTO sessions(id,csrf,expires) VALUES(?,?,?)').run(HASH(id), HASH(csrf), now() + 28_800_000);
          return reply(res, 200, { ok: true, csrf, role: 'commander' }, { 'Set-Cookie': `guild_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
        }
        if (rawPath === '/api/voice/status' && req.method === 'GET') {
          const config = await getVoice();
          return reply(res, 200, { ok: true, configured: config.configured, code: config.configured ? 'PERSONAL_AGENT_CONFIGURED_UNPROVEN' : config.reason, liveVerified: false });
        }
        if (rawPath === '/api/speech/status' && req.method === 'GET') return reply(res, 200, { ok: true, ...speech.status() });
        if (rawPath === '/api/speech' && req.method === 'POST') {
          const current = authorize(req, res); if (!current) return;
          if (Number(req.headers['content-length'] || 0) > SPEECH_LIMITS.bytes) { req.resume(); return reply(res, 413, { ok: false, code: 'AUDIO_BODY_LIMIT', message: 'La frase supera el límite de audio.' }); }
          const contentType = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
          if (!['audio/webm', 'audio/ogg', 'audio/wav'].includes(contentType)) { req.resume(); return reply(res, 415, { ok: false, code: 'AUDIO_FORMAT_REJECTED' }); }
          const limit = reserveSpeech(current);
          if (limit) { req.resume(); return reply(res, 429, { ok: false, code: limit, message: 'Espera a que termine la frase actual.' }, { 'Retry-After': '2' }); }
          const abort = new AbortController(); const disconnected = () => { if (!res.writableEnded) abort.abort(); }; res.once('close', disconnected);
          try {
            const bytes = await audioBody(req);
            const value = await speech.transcribe(bytes, contentType, { signal: abort.signal });
            if (abort.signal.aborted) return;
            return reply(res, value.transcript ? 200 : 422, value.transcript ? { ok: true, ...value } : { ok: false, code: 'NO_SPEECH', message: 'No reconocí una frase. Intenta hablar de nuevo.' });
          } catch (error) {
            if (abort.signal.aborted) return;
            const allowed = ['AUDIO_BODY_LIMIT','AUDIO_FORMAT_REJECTED','AUDIO_TOO_LONG','AUDIO_TOO_SHORT','AUDIO_DECODE_TIMEOUT','AUDIO_UPLOAD_TIMEOUT','LOCAL_ASR_UNAVAILABLE','LOCAL_ASR_FAILED','LOCAL_ASR_TIMEOUT','ABORTED'];
            const code = allowed.includes(error.code) ? error.code : 'LOCAL_ASR_FAILED';
            return reply(res, code === 'AUDIO_BODY_LIMIT' ? 413 : code === 'LOCAL_ASR_UNAVAILABLE' ? 503 : 422, { ok: false, code, message: code === 'LOCAL_ASR_UNAVAILABLE' ? 'El reconocimiento local no está disponible.' : 'No se pudo reconocer esta frase. Puedes escribir la orden.' });
          } finally { speechBusy = false; res.removeListener('close', disconnected); }
        }
        if (rawPath === '/api/voice/release' && req.method === 'POST') {
          const current = authorize(req, res); if (!current) return;
          const input = await body(req);
          if (typeof input.leaseId === 'string') database.prepare('DELETE FROM call_leases WHERE id=? AND session=?').run(input.leaseId, current.id);
          return reply(res, 200, { ok: true });
        }
        if (rawPath === '/api/voice/token' && req.method === 'POST') {
          const current = authorize(req, res); if (!current) return;
          await body(req);
          const config = await getVoice();
          if (res.destroyed) return;
          if (!config.configured) return reply(res, 503, { ok: false, code: config.reason || 'PERSONAL_AGENT_NOT_CONFIGURED', message: 'Agente personal no disponible: faltan acceso Agents y un agente privado verificado.' });
          const grant = reserveGrant(current);
          if (!grant.leaseId) return reply(res, grant.status, { ok: false, code: grant.code, message: grant.status === 429 ? 'Límite de llamadas alcanzado. Intenta más tarde.' : 'Ya existe una llamada activa.' }, grant.status === 429 ? { 'Retry-After': String(Math.ceil(grantWindow / 1000)) } : {});
          const abort = new AbortController();
          const releaseLease = () => database.prepare('DELETE FROM call_leases WHERE id=?').run(grant.leaseId);
          const disconnected = () => { if (!res.writableEnded) { abort.abort(); releaseLease(); } };
          res.once('close', disconnected);
          try {
            const url = `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(config.agentId)}`;
            const upstream = await fetcher(url, { headers: { 'xi-api-key': config.key }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(12_000)]) });
            if (!upstream.ok) throw new Error('VENDOR_REJECTED');
            const value = await upstream.json();
            if (abort.signal.aborted) return;
            if (typeof value.token !== 'string' || value.token.length < 10) throw new Error('VENDOR_SHAPE');
            return reply(res, 200, { ok: true, conversationToken: value.token, conversationId: typeof value.conversation_id === 'string' ? value.conversation_id : null, leaseId: grant.leaseId, hardCapMs, dynamicVariables: { name: 'Comandante', role: 'commander', language: 'es', canDo: 'Órdenes inmediatas del juego por nombres y lugares; Alto detiene unidades.' } });
          } catch {
            releaseLease();
            if (abort.signal.aborted) return;
            logs('VOICE_VENDOR_UNAVAILABLE');
            return reply(res, 502, { ok: false, code: 'VOICE_VENDOR_UNAVAILABLE', message: 'ElevenLabs no autorizó o no completó la llamada personal. Revisa los permisos Agents.' });
          } finally { res.removeListener('close', disconnected); }
        }
        return reply(res, 404, { ok: false, code: 'NOT_FOUND' });
      }
      if (!['GET', 'HEAD'].includes(req.method)) return reply(res, 405, { ok: false, code: 'METHOD_REJECTED' });
      const relative = publicPath(rawPath);
      if (!relative) return reply(res, 404, { ok: false, code: 'NOT_FOUND' });
      const requested = path.join(root, ...relative.split('/'));
      let resolved;
      try { resolved = await realpath(requested); } catch { return reply(res, 404, { ok: false, code: 'NOT_FOUND' }); }
      if (!within(root, resolved) || publicPath(`/${path.relative(root, resolved).split(path.sep).join('/')}`) === null || !(await stat(resolved)).isFile()) return reply(res, 404, { ok: false, code: 'NOT_FOUND' });
      const bytes = await readFile(resolved);
      res.writeHead(200, { ...safeHeaders, 'Content-Type': TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Guild-Source-Hash': HASH(bytes) });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      logs('REQUEST_REJECTED');
      if (!res.headersSent) reply(res, 400, { ok: false, code: 'REQUEST_REJECTED' });
      else res.end();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return {
    server, root,
    async listen(requestedPort = options.port ?? 4173) {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(requestedPort, '127.0.0.1', resolve); });
      port = server.address().port;
      return { url: `http://127.0.0.1:${port}`, port };
    },
    async close() { if (closed) return; closed = true; await speech.close(); await new Promise((resolve) => server.close(resolve)); server.closeAllConnections(); database.close(); }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await createGameServer();
  const { url } = await app.listen(Number(process.env.GUILD_PORT || 4173));
  process.stdout.write(`Gremios del Alba ${url}\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.close().then(() => process.exit(0)); });
}
