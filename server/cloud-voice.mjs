import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const COOKIE = 'guild_cloud';
const SESSION_MS = 28_800_000;
const HARD_CAP_MS = 300_000;
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Standard Vercel Protection leaves the production domain public and protects
// immutable deployment URLs. Paid voice is issued only on that private host.
// In-memory issuance/lease limits are per instance, not a billing ledger.
export function createCloudHandler({ environment = process.env, fetcher = fetch, now = Date.now, maxGrants = 20 } = {}) {
  const grants = [], leases = new Map();
  const origin = environment.GUILD_PUBLIC_ORIGIN || '';
  const secret = environment.GUILD_SESSION_SECRET || '';
  const sessionConfigured = /^https:\/\/[^/]+$/u.test(origin) && secret.length >= 32;
  const privateOrigin = /^[a-zA-Z0-9.-]+$/u.test(environment.VERCEL_URL || '') ? `https://${environment.VERCEL_URL}` : null;
  const personalConfigured = environment.GUILD_DEPLOYMENT_PROTECTION === 'vercel-auth' && Boolean(environment.ELEVENLABS_API_KEY?.trim()) && /^[a-zA-Z0-9_-]{5,160}$/u.test(environment.ELEVENLABS_AGENT_ID || '');
  const sign = (value) => createHmac('sha256', secret).update(value).digest('hex');
  const csrf = (cookie) => sign(`csrf:${cookie}`);
  const getSession = (req) => {
    const value = String(req.headers.cookie || '').match(/(?:^|;\s*)guild_cloud=([a-f0-9]{48}\.\d{1,16}\.[a-f0-9]{64})(?:;|$)/u)?.[1];
    if (!value) return null;
    const [nonce, expiry, signature] = value.split('.');
    return Number(expiry) > now() && Number(expiry) <= now() + SESSION_MS && equal(signature, sign(`${nonce}.${expiry}`)) ? value : null;
  };
  const body = (req) => {
    if (Number(req.headers['content-length'] || 0) > 8192) throw Object.assign(new Error(), { status: 413 });
    const value = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? String(req.body) : JSON.stringify(req.body ?? {});
    if (Buffer.byteLength(value) > 8192) throw Object.assign(new Error(), { status: 413 });
    let parsed; try { parsed = JSON.parse(value); } catch { throw Object.assign(new Error(), { status: 400 }); }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw Object.assign(new Error(), { status: 400 });
    return parsed;
  };
  return async function handler(req, res) {
    const reply = (status, value, extra = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
      res.end(JSON.stringify(value));
    };
    try {
      if (!sessionConfigured) return reply(503, { ok: false, configured: false, code: 'SESSION_NOT_CONFIGURED' });
      const requestOrigin = `https://${req.headers.host}`;
      if (![origin, privateOrigin].includes(requestOrigin) || req.headers.origin && req.headers.origin !== requestOrigin || req.headers['sec-fetch-site'] === 'cross-site') return reply(403, { ok: false, code: 'ORIGIN_REJECTED' });
      const privateVoice = requestOrigin === privateOrigin && requestOrigin !== origin;
      const configured = personalConfigured && privateVoice;
      const voiceCode = !privateVoice ? 'PERSONAL_VOICE_PRIVATE' : 'PERSONAL_AGENT_NOT_CONFIGURED';
      const url = new URL(req.url, requestOrigin);
      const route = url.searchParams.get('route') || url.pathname.replace(/^\/api\//u, '');
      if (req.method === 'GET') {
        if (route === 'health') return reply(200, { ok: true, project: 'gremios-del-alba', runtime: 'vercel', revision: environment.VERCEL_GIT_COMMIT_SHA || null });
        if (route === 'voice/status') return reply(200, { ok: true, configured, code: configured ? 'PERSONAL_AGENT_CONFIGURED_UNPROVEN' : voiceCode, liveVerified: false });
        if (route === 'speech/status') return reply(200, { ok: true, ready: false, state: 'unavailable', code: 'BROWSER_SPEECH_AVAILABLE', message: 'En este despliegue usa Voz del navegador o llama a Sota.' });
        if (route === 'session') {
          const value = getSession(req) || (() => { const payload = `${randomBytes(24).toString('hex')}.${now() + SESSION_MS}`; return `${payload}.${sign(payload)}`; })();
          return reply(200, { ok: true, csrf: csrf(value), role: 'commander' }, { 'Set-Cookie': `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.max(0, Math.floor((Number(value.split('.')[1]) - now()) / 1000))}` });
        }
      }
      if (req.method !== 'POST' || !['voice/token', 'voice/release', 'speech'].includes(route)) return reply(404, { ok: false, code: 'NOT_FOUND' });
      const session = getSession(req);
      if (!session) return reply(401, { ok: false, code: 'SESSION_REQUIRED' });
      if (req.headers.origin !== requestOrigin || !equal(req.headers['x-guild-csrf'], csrf(session))) return reply(403, { ok: false, code: 'CSRF_REJECTED' });
      if (route === 'speech') return reply(503, { ok: false, code: 'LOCAL_ASR_UNAVAILABLE', message: 'Usa Voz del navegador o llama a Sota.' });
      if (String(req.headers['content-type'] || '').split(';')[0] !== 'application/json') return reply(415, { ok: false, code: 'JSON_REQUIRED' });
      const input = body(req);
      if (route === 'voice/release') {
        if (leases.get(input.leaseId)?.session === session) leases.delete(input.leaseId);
        return reply(200, { ok: true });
      }
      if (!configured) return reply(503, { ok: false, code: voiceCode });
      while (grants.length && grants[0] <= now() - 600_000) grants.shift();
      for (const [id, lease] of leases) if (lease.expires <= now()) leases.delete(id);
      if (grants.length >= maxGrants) return reply(429, { ok: false, code: 'GRANT_LIMIT' }, { 'Retry-After': '600' });
      if (leases.size) return reply(409, { ok: false, code: 'CALL_ALREADY_ACTIVE' });
      const leaseId = randomBytes(24).toString('hex');
      grants.push(now()); leases.set(leaseId, { session, expires: now() + HARD_CAP_MS });
      try {
        const response = await fetcher(`https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(environment.ELEVENLABS_AGENT_ID)}`, { headers: { 'xi-api-key': environment.ELEVENLABS_API_KEY.trim() }, signal: AbortSignal.timeout(12_000) });
        if (!response.ok) throw new Error('VENDOR_REJECTED');
        const value = await response.json();
        if (typeof value.token !== 'string' || value.token.length < 10) throw new Error('VENDOR_SHAPE');
        return reply(200, { ok: true, conversationToken: value.token, conversationId: typeof value.conversation_id === 'string' ? value.conversation_id : null, leaseId, hardCapMs: HARD_CAP_MS, dynamicVariables: { name: 'Comandante', role: 'commander', language: 'es', canDo: 'Órdenes inmediatas del juego por nombres y lugares; Alto detiene unidades.' } });
      } catch {
        leases.delete(leaseId);
        return reply(502, { ok: false, code: 'VOICE_VENDOR_UNAVAILABLE', message: 'No se pudo conectar el agente personal. Intenta otra vez.' });
      }
    } catch (error) {
      return reply(error.status === 413 ? 413 : error.status === 400 ? 400 : 500, { ok: false, code: error.status ? 'BODY_REJECTED' : 'REQUEST_FAILED' });
    }
  };
}
