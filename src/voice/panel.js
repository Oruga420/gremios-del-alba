import { t, getLocale, onLocaleChange, translateDOM, DEFAULT_LOCALE } from '../i18n/index.js';
import { display } from './i18n.js';
import { SPEECH_LANGUAGES } from './speech.js';

const hasText = key => t(key) !== key;
const plural = (base, count) => t(`${base}.${count === 1 ? 'one' : 'other'}`, { count });

export function mountVoicePanel({ mount, onCommand, onMic, onAgent, onEnd, onConfirm, onStop, onMute = () => {}, onModeChange = () => {}, directMode = true }) {
  // Static text is bound with data-i18n* attributes and refreshed by translateDOM on locale change.
  mount.innerHTML = `<section class="guild-voice" aria-labelledby="guild-voice-title" data-phase="idle" hidden>
    <header><h3 id="guild-voice-title" data-i18n="voice.panel.title"></h3><span class="guild-voice-caption" data-i18n="voice.panel.caption"></span><button type="button" data-voice-action="close" data-i18n-aria-label="voice.panel.close">×</button></header>
    <div class="guild-voice-call">
      <div class="guild-voice-state"><span class="guild-voice-orb" data-mode="idle" aria-hidden="true"></span><div><p class="guild-voice-call-status" role="status" aria-live="polite"></p><p class="guild-voice-call-hint"></p></div></div>
      <div class="guild-voice-call-actions"><button type="button" data-voice-action="mute" aria-pressed="false" hidden></button><button type="button" data-voice-action="end" data-i18n="voice.panel.hangUp" hidden></button><button type="button" data-voice-action="agent" aria-describedby="guild-agent-availability" disabled></button></div>
      <p id="guild-agent-availability" data-i18n="voice.panel.checkingAvailability"></p>
      <p class="guild-voice-notice" role="status" hidden></p>
      <p class="guild-voice-activity" role="status" hidden></p>
      <button type="button" data-voice-action="stop-header" data-i18n="voice.panel.stop" data-i18n-aria-label="voice.panel.stopUnits" ${directMode ? '' : 'hidden'}></button>
    </div>
    <ol class="guild-voice-transcript" data-i18n-aria-label="voice.panel.conversation" aria-live="polite"></ol>
    <form class="guild-voice-form"><label class="sr-only" for="guild-voice-command" data-i18n="voice.panel.typeInstead"></label><div><input id="guild-voice-command" name="command" maxlength="240" autocomplete="off" data-i18n-placeholder="voice.panel.typeInstead" required><button type="submit" data-voice-action="send" data-i18n-aria-label="voice.panel.send">↗</button></div></form>
    ${directMode ? '' : '<div class="guild-voice-proposal" hidden role="region" data-i18n-aria-label="voice.panel.proposal.region"><small data-i18n="voice.panel.proposal.caption"></small><h4></h4><ul tabindex="0" data-i18n-aria-label="voice.panel.proposal.list"></ul><p></p><div><button type="button" data-voice-action="confirm" data-i18n="voice.panel.proposal.confirm"></button><button type="button" data-voice-action="stop" data-i18n="voice.panel.proposal.stop"></button></div></div>'}
    <details class="guild-voice-local"><summary data-i18n="voice.panel.local.summary"></summary><p data-i18n="voice.panel.local.description"></p><div class="guild-voice-modes"><button type="button" data-voice-action="mic"></button><select data-i18n-aria-label="voice.panel.recognizer" data-voice-action="recognizer"><option value="local" disabled></option><option value="browser" data-i18n="voice.panel.recognizer.browser"></option></select><select data-i18n-aria-label="voice.panel.language" data-voice-action="language"></select></div><p class="guild-voice-status" role="status" aria-live="polite" data-mode="local" data-i18n="voice.panel.checkingMicrophone"></p><p class="guild-voice-native" data-i18n="voice.panel.checkingNative"></p><p data-i18n="voice.panel.local.examples"></p></details>
  </section>`;
  const panel = mount.querySelector('.guild-voice');
  const status = panel.querySelector('.guild-voice-status');
  const transcript = panel.querySelector('.guild-voice-transcript');
  const proposal = panel.querySelector('.guild-voice-proposal');
  const form = panel.querySelector('form');
  const input = form.querySelector('input');
  const orb = panel.querySelector('.guild-voice-orb');
  const callStatus = panel.querySelector('.guild-voice-call-status');
  const callHint = panel.querySelector('.guild-voice-call-hint');
  const notice = panel.querySelector('.guild-voice-notice');
  const activity = panel.querySelector('.guild-voice-activity');
  const availability = panel.querySelector('#guild-agent-availability');
  const launcher = mount.ownerDocument.querySelector('[data-action="voice"]');
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const get = (action) => panel.querySelector(`[data-voice-action="${action}"]`);
  let microphoneActive = false, userSelectedMode = false, agentConfigured = false, agentBusy = false, muted = false, sending = false, attemptedCall = false;
  // Last dynamic values, re-rendered when the language changes.
  let lastCall = null, lastMicrophone = null, lastAvailability = null, lastNative = null, lastLocal = { state: 'starting', ready: false }, lastProposal = null, lastActivity = null, noticeKey = null;
  function visible(value = !panel.hidden) { const opening = value && panel.hidden; panel.hidden = !value; launcher?.setAttribute('aria-expanded', String(value)); if (opening && !agentBusy) get('close').focus({ preventScroll: true }); }
  function setMuted(value) { muted = Boolean(value); get('mute').setAttribute('aria-pressed', String(muted)); get('mute').textContent = t(muted ? 'voice.panel.unmute' : 'voice.panel.mute'); }
  function setActivity(title, name) {
    lastActivity = title ? { title, name } : null;
    const text = title && name && hasText(`voice.tool.${name}`) ? t(`voice.tool.${name}`) : String(title || '');
    activity.textContent = text.slice(0, 180); activity.hidden = !activity.textContent;
  }
  function renderCallControls() {
    get('agent').disabled = !agentConfigured || agentBusy;
    get('agent').hidden = agentBusy;
    get('agent').textContent = t(attemptedCall ? 'voice.panel.callAgain' : 'voice.panel.call');
    get('end').hidden = !agentBusy;
    get('mute').hidden = !agentBusy;
    get('mute').disabled = panel.dataset.phase !== 'active';
    get('mic').disabled = agentBusy;
    get('recognizer').disabled = agentBusy;
    get('language').disabled = agentBusy;
    availability.hidden = agentBusy || agentConfigured;
    launcher?.classList.toggle('voice-live', agentBusy);
  }
  /** Recognition languages follow the interface language; Spanish keeps es-MX first, as before. */
  function renderLanguages() {
    const select = get('language'), previous = select.value;
    const tags = SPEECH_LANGUAGES[getLocale()] || SPEECH_LANGUAGES[DEFAULT_LOCALE];
    const same = select.options.length === tags.length && tags.every((tag, index) => select.options[index].value === tag);
    if (!same) {
      select.replaceChildren(...tags.map(tag => { const option = mount.ownerDocument.createElement('option'); option.value = tag; option.lang = tag; return option; }));
      select.value = tags.includes(previous) ? previous : tags[0];
    }
    for (const option of select.options) option.textContent = hasText(`voice.panel.language.${option.value}`) ? t(`voice.panel.language.${option.value}`) : option.value;
  }
  function renderLocal() {
    const value = lastLocal, option = get('recognizer').querySelector('[value="local"]');
    option.disabled = !value.ready;
    option.textContent = t(value.ready ? 'voice.panel.recognizer.localReady' : value.state === 'starting' ? 'voice.panel.recognizer.localPreparing' : 'voice.panel.recognizer.localUnavailable');
    if (!microphoneActive && !userSelectedMode) {
      // The local recognizer only understands Spanish; other languages default to the browser's.
      if (value.ready && getLocale() === DEFAULT_LOCALE) get('recognizer').value = 'local';
      else if (get('recognizer').value === 'local' && (!value.ready || getLocale() !== DEFAULT_LOCALE)) get('recognizer').value = 'browser';
    }
  }
  function renderMicButton(mode) {
    const selected = get('recognizer').value === 'local' ? 'local' : 'browser';
    get('mic').textContent = t(microphoneActive ? `voice.panel.end.${mode === 'local' ? 'local' : 'browser'}` : `voice.panel.listen.${selected}`);
    get('mic').setAttribute('aria-pressed', String(microphoneActive));
  }
  function renderAvailability() {
    const value = lastAvailability;
    if (!value) return;
    const explanation = t(agentConfigured ? 'voice.panel.agent.available' : value.code === 'PERSONAL_VOICE_PRIVATE' ? 'voice.panel.agent.private' : value.code === 'PERSONAL_AGENT_NOT_CONFIGURED' ? 'voice.panel.agent.notConfigured' : 'voice.panel.agent.unavailable');
    availability.textContent = explanation;
    get('agent').title = explanation;
  }
  function renderCall() {
    const value = lastCall;
    if (!value) { callStatus.textContent = t('voice.panel.readyToCall'); callHint.textContent = t('voice.panel.hint.idle'); return; }
    const connecting = ['connecting', 'reconnecting'].includes(value.state);
    callStatus.textContent = t(connecting ? value.state === 'reconnecting' ? 'voice.panel.call.reconnecting' : 'voice.panel.call.connecting' : value.active ? value.state === 'speaking' ? 'voice.panel.call.speaking' : 'voice.panel.call.listening' : ['blocked', 'error', 'unavailable'].includes(value.state) ? 'voice.panel.call.failed' : 'voice.panel.call.ended');
    callHint.textContent = t(agentBusy ? 'voice.panel.hint.active' : 'voice.panel.hint.ended');
    notice.textContent = !agentBusy ? display(value, 'message') : '';
    notice.hidden = !notice.textContent;
  }
  function renderMicrophoneStatus() {
    const value = lastMicrophone;
    if (!value) { renderMicButton(get('recognizer').value); return; }
    const mode = value.mode || get('recognizer').value;
    status.textContent = t('voice.panel.statusLine', { mode: t(mode === 'local' ? 'voice.panel.mode.local' : 'voice.panel.mode.browser'), message: value.i18n || value.message ? display(value, 'message') : value.state });
    status.dataset.state = value.state; status.dataset.mode = mode;
    renderMicButton(mode);
  }
  function renderNative() {
    const value = lastNative;
    if (!value) return;
    panel.querySelector('.guild-voice-native').textContent = value.state === 'native-registered' ? plural('voice.panel.native.registered', value.registered.length) : value.state === 'legacy-registered' ? plural('voice.panel.native.legacy', value.registered.length) : value.state === 'registration-failed' ? plural('voice.panel.native.failed', value.failures.length) : t('voice.panel.native.unavailable');
  }
  function renderProposal(now = Date.now()) {
    const value = lastProposal;
    if (directMode || !value) return;
    proposal.querySelector('h4').textContent = hasText(`voice.tool.${value.action.toolName}`) ? t(`voice.tool.${value.action.toolName}`) : value.action.title;
    const list = proposal.querySelector('ul'); list.replaceChildren();
    (value.action.lines || []).forEach((text, index) => { const item = document.createElement('li'); const record = value.action.lineI18n?.[index]; item.textContent = record ? display({ speak: text, i18n: record }) : text; list.append(item); });
    proposal.querySelector('p').textContent = value.state === 'countdown' ? t('voice.panel.proposal.countdown', { seconds: Math.max(0, Math.ceil((value.stopWindowEndsAt - now) / 1000)) }) : t(value.state === 'armed' ? 'voice.panel.proposal.armed' : 'voice.panel.proposal.prompt');
  }
  function renderTranscript() {
    for (const entry of transcript.children) {
      entry.querySelector('small').textContent = t(entry.dataset.speaker === 'you' ? 'voice.panel.speaker.you' : 'voice.panel.speaker.agent');
      if (entry.voiceRecord) entry.querySelector('span').textContent = display(entry.voiceRecord).slice(0, 600);
    }
  }
  function renderAll() {
    translateDOM(panel);
    setMuted(muted); renderCallControls(); renderLanguages(); renderLocal(); renderAvailability(); renderCall();
    renderMicrophoneStatus(); renderNative(); renderProposal(); renderTranscript();
    if (noticeKey) notice.textContent = t(noticeKey);
    if (lastActivity) setActivity(lastActivity.title, lastActivity.name);
  }
  get('close').addEventListener('click', () => { onEnd('closed'); visible(false); }, options);
  get('mic').addEventListener('click', (event) => onMic(event, get('language').value, get('recognizer').value), options);
  get('recognizer').addEventListener('change', () => { userSelectedMode = true; onModeChange(get('recognizer').value); }, options);
  get('agent').addEventListener('click', onAgent, options);
  get('end').addEventListener('click', () => onEnd('disconnected'), options);
  get('mute').addEventListener('click', () => onMute(!muted), options);
  get('confirm')?.addEventListener('click', onConfirm, options);
  get('stop')?.addEventListener('click', onStop, options);
  get('stop-header').addEventListener('click', onStop, options);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || sending) return;
    sending = true; get('send').disabled = true;
    try {
      const result = await onCommand(text, { source: 'typed' });
      if (result !== false && result?.ok !== false && input.value.trim() === text) input.value = '';
    } catch {
      noticeKey = 'voice.panel.sendFailed';
      notice.textContent = t(noticeKey);
      notice.hidden = false;
    } finally { sending = false; get('send').disabled = false; }
  }, options);
  renderAll();
  // Live language switch (no reload): every visible string is rebuilt from its key or stored record.
  const stopLocale = onLocaleChange(() => renderAll());
  controller.signal.addEventListener('abort', stopLocale);
  return {
    panel, visible, setMuted, setActivity,
    /** Display text of a result in the active language (falls back to its Spanish `speak`). */
    text: (value) => display(value),
    setAudioLevel(level) { const value = Number(level); orb.style.setProperty('--voice-level', String(agentBusy && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0)); },
    addTranscript(text, source = 'agent', record = null) {
      const entry = document.createElement('li'); entry.dataset.source = source;
      entry.dataset.speaker = ['typed', 'browser-speech', 'local-speech', 'elevenlabs-user'].includes(source) ? 'you' : 'agent';
      if (record?.i18n) entry.voiceRecord = { speak: String(record.speak ?? text), i18n: record.i18n };
      const who = document.createElement('small'); who.textContent = t(entry.dataset.speaker === 'you' ? 'voice.panel.speaker.you' : 'voice.panel.speaker.agent');
      const line = document.createElement('span'); line.textContent = String(text).slice(0, 600);
      entry.append(who, line); transcript.append(entry); while (transcript.children.length > 8) transcript.firstElementChild.remove(); transcript.scrollTop = transcript.scrollHeight;
    },
    setLocalReady(value) { lastLocal = value; renderLocal(); },
    setAgentAvailability(value) {
      agentConfigured = value.configured === true; lastAvailability = value;
      renderAvailability();
      if (value.code === 'PERSONAL_VOICE_PRIVATE') panel.querySelector('.guild-voice-local').open = true;
      renderCallControls();
    },
    setStatus(value) {
      if (value.mode === 'elevenlabs') {
        const connecting = ['connecting', 'reconnecting'].includes(value.state);
        agentBusy = Boolean(value.active || connecting);
        attemptedCall = true; lastCall = value; noticeKey = null;
        panel.dataset.phase = connecting ? 'connecting' : value.active ? 'active' : 'ended';
        orb.dataset.mode = connecting ? 'connecting' : value.active ? value.state === 'speaking' ? 'speaking' : 'listening' : 'ended';
        callStatus.dataset.state = value.state;
        renderCall();
        if (!agentBusy) { setActivity(''); setMuted(false); orb.style.setProperty('--voice-level', '0'); }
        renderCallControls();
        return;
      }
      if (['browser','local'].includes(value.mode)) microphoneActive = Boolean(value.active);
      if (!value.mode && microphoneActive) return;
      lastMicrophone = value;
      renderMicrophoneStatus();
    },
    setNative(value) { lastNative = value; renderNative(); },
    setProposal(value, now = Date.now()) {
      if (directMode) return;
      const pending = value && ['proposed', 'armed', 'countdown'].includes(value.state); proposal.hidden = !pending; get('stop-header').hidden = !pending;
      lastProposal = pending ? value : null;
      if (!pending) return;
      visible(true); renderProposal(now);
      get('confirm').disabled = value.state !== 'proposed';
    },
    destroy() { controller.abort(); mount.replaceChildren(); }
  };
}
