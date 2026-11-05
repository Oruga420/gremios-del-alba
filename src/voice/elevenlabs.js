// Official SDK integration, loaded only on explicit call. No CDN, global key or shim.
import { t, getLocale, localeInfo, onLocaleChange, DEFAULT_LOCALE } from '../i18n/index.js';
import { status as said, phrase } from './i18n.js';
const SDK_MODULE = '/assets/vendor/elevenlabs-client.js';
export function createPersonalAgent({ tools, runTool, confirm, onStatus, onTranscript, onAudioLevel = () => {}, onMuted = () => {}, onActivity = () => {}, fetcher = fetch, sdkLoader = () => import(SDK_MODULE) }) {
  let conversation = null;
  let grant = null;
  let csrf = null;
  let epoch = 0;
  let hardTimer = null;
  let idleTimer = null;
  let lastSpeakingBinding = null;
  let starting = false;
  let connectionAbort = null;
  let audioTimer = null, activityTimer = null, muted = false, activityVersion = 0;
  let pendingEchoes = [];
  const releasedGrants = new WeakSet();
  // Tell the conversational agent which language the player reads, without changing the server
  // grant: the dynamic variable `language` (already sent as 'es') and, for other languages, one
  // contextual update. Spanish keeps the original behaviour exactly.
  // The language is named by its own label and code, so the message stays right even while that
  // language's dictionary lacks this key. Switching back to Spanish mid-call is announced too.
  let toldLanguage = null;
  function tellLanguage(instance = conversation) {
    const locale = getLocale();
    if (!instance || typeof instance.sendContextualUpdate !== 'function') return;
    if (locale === DEFAULT_LOCALE && toldLanguage === null) return;
    if (locale === toldLanguage) return;
    try { instance.sendContextualUpdate(t('voice.call.languageContext', { language: localeInfo(locale).label, code: locale })); toldLanguage = locale; } catch { /* Optional SDK feature. */ }
  }
  const stopLanguageWatch = onLocaleChange(() => { if (conversation) tellLanguage(); });
  const messageIds = new Set();
  async function release(previous = grant, previousCsrf = csrf) {
    if (previous === grant) grant = null;
    if (previous && previousCsrf && !releasedGrants.has(previous)) { releasedGrants.add(previous); try { await fetcher('/api/voice/release', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Guild-CSRF': previousCsrf }, body: JSON.stringify({ leaseId: previous.leaseId }), keepalive: true }); } catch { /* Lease expires server-side. */ } }
  }
  async function end(reason = 'disconnected') {
    if (!conversation && !grant && !starting) return;
    const endedEpoch = ++epoch;
    connectionAbort?.abort(); connectionAbort = null; starting = false;
    clearTimeout(hardTimer); clearTimeout(idleTimer); lastSpeakingBinding = null;
    clearInterval(audioTimer); clearTimeout(activityTimer); audioTimer = null; activityVersion++;
    pendingEchoes = []; messageIds.clear(); muted = false; onMuted(false); onAudioLevel(0); onActivity('');
    if (conversation || grant) confirm.invalidate(reason.toUpperCase());
    const previous = conversation, previousGrant = grant, previousCsrf = csrf; conversation = null; grant = null;
    const released = release(previousGrant, previousCsrf);
    if (previous) { try { await previous.endSession(); } catch { /* Already disconnected. */ } }
    await released;
    const message = reason === 'world-changed' ? 'voice.call.worldChanged' : reason === 'hard-cap' ? 'voice.call.hardCap' : reason === 'idle-timeout' ? 'voice.call.idleTimeout' : reason === 'quota' ? 'voice.call.quota' : 'voice.call.ended';
    if (endedEpoch === epoch) onStatus({ mode: 'elevenlabs', state: reason, active: false, ...said(message) });
    return endedEpoch;
  }
  function resetIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(() => end('idle-timeout'), 90_000); }
  async function setMuted(value) {
    if (!conversation) return { ok: false, code: 'CALL_NOT_ACTIVE' };
    const instance = conversation, callEpoch = epoch;
    try {
      await instance.setMicMuted(Boolean(value));
      if (callEpoch !== epoch || instance !== conversation) return { ok: false, code: 'DISCONNECTED' };
      muted = Boolean(value); onMuted(muted); resetIdle(); return { ok: true, muted };
    } catch { return { ok: false, code: 'MIC_MUTE_FAILED' }; }
  }
  function sendText(value) {
    const text = String(value ?? '').trim();
    if (!conversation) { const value = phrase('voice.call.waitForConnection'); return { ok: false, code: 'CALL_NOT_ACTIVE', speak: value.text, i18n: value.i18n }; }
    if (!text) return { ok: false, code: 'EMPTY_MESSAGE' };
    const echo = { text, at: Date.now() }, callEpoch = epoch;
    pendingEchoes = pendingEchoes.filter(item => Date.now() - item.at < 30_000);
    pendingEchoes.push(echo);
    try { conversation.sendUserMessage(text); }
    catch { pendingEchoes = pendingEchoes.filter(item => item !== echo); const value = phrase('voice.call.sendFailed'); return { ok: false, code: 'MESSAGE_FAILED', speak: value.text, i18n: value.i18n }; }
    if (callEpoch !== epoch) return { ok: false, code: 'DISCONNECTED' };
    resetIdle(); onTranscript(text, { source: 'elevenlabs-user' });
    return { ok: true, code: 'MESSAGE_SENT' };
  }
  async function start(event) {
    if (event?.isTrusted !== true) return { ok: false, code: 'GESTURE_REQUIRED' };
    if (starting) return { ok: false, code: 'CALL_STARTING' };
    if (conversation) return { ok: true, code: 'ALREADY_CONNECTED' };
    starting = true;
    const callEpoch = ++epoch;
    const sessionEpoch = confirm.sessionEpoch;
    const abort = new AbortController(); connectionAbort = abort;
    onStatus({ mode: 'elevenlabs', state: 'connecting', active: false, ...said('voice.call.checkingAccess') });
    try {
      const status = await (await fetcher('/api/voice/status', { cache: 'no-store', signal: abort.signal })).json();
      if (callEpoch !== epoch) return { ok: false, code: 'DISCONNECTED' };
      if (!status.configured) throw new Error(status.code || 'PERSONAL_AGENT_NOT_CONFIGURED');
      let module;
      try { module = await sdkLoader(); } catch { throw new Error('OFFICIAL_SDK_UNAVAILABLE'); }
      if (callEpoch !== epoch) return { ok: false, code: 'DISCONNECTED' };
      if (typeof module.Conversation?.startSession !== 'function') throw new Error('OFFICIAL_SDK_UNAVAILABLE');
      const session = await (await fetcher('/api/session', { cache: 'no-store', signal: abort.signal })).json();
      if (callEpoch !== epoch) return { ok: false, code: 'DISCONNECTED' };
      const callCsrf = session.csrf; csrf = callCsrf;
      const response = await fetcher('/api/voice/token', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Guild-CSRF': callCsrf }, body: '{}', signal: abort.signal });
      const value = await response.json(); if (!response.ok) throw new Error(value.code || 'VOICE_VENDOR_UNAVAILABLE');
      if (callEpoch !== epoch) { await release(value, callCsrf); return { ok: false, code: 'DISCONNECTED' }; }
      grant = value;
      const clientTools = Object.fromEntries(tools.map((tool) => [tool.name, async (input) => {
        if (callEpoch !== epoch) return JSON.stringify({ ok: false, code: 'STALE_SESSION', speak: 'La sesión cambió.' });
        if (confirm.sessionEpoch !== sessionEpoch) { await end('world-changed'); return JSON.stringify({ ok: false, code: 'STALE_SESSION', speak: 'La partida cambió. Vuelve a llamar.' }); }
        resetIdle(); const activity = ++activityVersion; clearTimeout(activityTimer); onActivity(tool.title || tool.name, tool.name);
        try { return JSON.stringify(await runTool(tool.name, input, { source: 'elevenlabs', sessionEpoch })); }
        catch { return JSON.stringify({ ok: false, code: 'TOOL_FAILED', speak: 'No pude completar esa orden.' }); }
        finally { if (callEpoch === epoch && activity === activityVersion) activityTimer = setTimeout(() => { if (callEpoch === epoch && activity === activityVersion) onActivity(''); }, 1500); }
      }]));
      const instance = await module.Conversation.startSession({ conversationToken: value.conversationToken, connectionType: 'webrtc', dynamicVariables: { ...value.dynamicVariables, ...(getLocale() !== DEFAULT_LOCALE ? { language: getLocale() } : {}) }, clientTools, workletPaths: { rawAudioProcessor: '/assets/vendor/elevenlabs-raw-audio-processor.js' },
        onConnect: () => { if (callEpoch === epoch) { resetIdle(); onStatus({ mode: 'elevenlabs', state: 'connected', active: true, ...said('voice.call.connected') }); } },
        onDisconnect: () => { if (callEpoch === epoch) end('disconnected'); },
        onError: (message) => { if (callEpoch === epoch) end(/quota|daily.limit|usage.limit/iu.test(String(message)) ? 'quota' : 'error'); },
        onStatusChange: ({ status }) => {
          if (callEpoch !== epoch) return;
          if (status === 'disconnected') { end('disconnected'); return; }
          if (!['connecting', 'connected', 'reconnecting', 'disconnecting'].includes(status)) return;
          onStatus({ mode: 'elevenlabs', state: status, active: ['connected', 'reconnecting'].includes(status), ...said(status === 'reconnecting' ? 'voice.call.reconnecting' : status === 'connected' ? 'voice.call.connected' : status === 'disconnecting' ? 'voice.call.disconnecting' : 'voice.call.connecting') });
        },
        onInterruption: () => {
          if (callEpoch !== epoch) return;
          lastSpeakingBinding = null; resetIdle(); onAudioLevel(0);
          onStatus({ mode: 'elevenlabs', state: 'listening', active: true, ...said('voice.call.listening') });
        },
        onMessage: (message) => {
          if (callEpoch !== epoch || typeof message?.message !== 'string' || !message.message.trim()) return;
          const user = message.source === 'user' || message.role === 'user';
          const id = message.event_id ?? message.message_id;
          if (id !== undefined) { const key = `${user}:${id}`; if (messageIds.has(key)) return; messageIds.add(key); }
          resetIdle();
          pendingEchoes = pendingEchoes.filter(item => Date.now() - item.at < 30_000);
          const echo = user ? pendingEchoes.findIndex(item => item.text === message.message.trim()) : -1;
          if (echo !== -1) { pendingEchoes.splice(echo, 1); return; }
          onTranscript(message.message, { source: user ? 'elevenlabs-user' : 'elevenlabs-agent' });
        },
        onModeChange: ({ mode }) => {
          if (callEpoch !== epoch) return;
          if (mode === 'speaking') { const pending = confirm.getState(); lastSpeakingBinding = pending?.state === 'armed' ? pending : null; }
          if (mode === 'listening' && lastSpeakingBinding) { confirm.speechEnded(lastSpeakingBinding); lastSpeakingBinding = null; }
          onStatus({ mode: 'elevenlabs', state: mode, active: true, ...said(mode === 'speaking' ? 'voice.call.speaking' : 'voice.call.listening') });
        }
      });
      if (callEpoch !== epoch) { await instance.endSession(); await release(value, callCsrf); return { ok: false, code: 'DISCONNECTED' }; }
      conversation = instance; toldLanguage = null; tellLanguage(instance); hardTimer = setTimeout(() => end('hard-cap'), Math.min(300_000, Number(value.hardCapMs) > 0 ? Number(value.hardCapMs) : 300_000)); resetIdle();
      muted = false; onMuted(false);
      audioTimer = setInterval(() => {
        if (callEpoch !== epoch || instance !== conversation) return;
        let level = 0; try { level = Number(instance.getOutputVolume?.()) || 0; } catch { /* Audio may be reconnecting. */ }
        onAudioLevel(Math.max(0, Math.min(1, level)));
      }, 100);
      return { ok: true, code: 'CONNECTED' };
    } catch (error) {
      if (callEpoch !== epoch) return { ok: false, code: 'DISCONNECTED' };
      starting = false;
      const endedEpoch = await end('unavailable');
      if ((endedEpoch ?? callEpoch) !== epoch) return { ok: false, code: 'DISCONNECTED' };
      const code = /^[A-Z_]{3,80}$/u.test(error?.message || '') ? error.message : 'VOICE_VENDOR_UNAVAILABLE';
      const message = code === 'OFFICIAL_SDK_UNAVAILABLE' ? 'voice.call.sdkUnavailable' : code === 'GRANT_LIMIT' || code === 'DAILY_CALL_LIMIT' ? 'voice.call.limit' : code === 'PERSONAL_AGENT_NOT_CONFIGURED' ? 'voice.call.notConfigured' : code === 'CALL_ALREADY_ACTIVE' ? 'voice.call.alreadyActive' : 'voice.call.vendorFailed';
      onStatus({ mode: 'elevenlabs', state: 'blocked', active: false, code, ...said(message) });
      return { ok: false, code };
    } finally { if (callEpoch === epoch) { starting = false; connectionAbort = null; } }
  }
  return { start, end, setMuted, sendText, get muted() { return muted; }, get active() { return Boolean(conversation); }, get engaged() { return Boolean(conversation || grant || starting); }, destroy: () => { stopLanguageWatch(); return end('disconnected'); } };
}
