export function mountVoicePanel({ mount, onCommand, onMic, onAgent, onEnd, onConfirm, onStop, onMute = () => {}, onModeChange = () => {}, directMode = true }) {
  mount.innerHTML = `<section class="guild-voice" aria-labelledby="guild-voice-title" data-phase="idle" hidden>
    <header><h3 id="guild-voice-title">Sota</h3><span class="guild-voice-caption">TU GREMIO, EN VOZ</span><button type="button" data-voice-action="close" aria-label="Colgar y cerrar">×</button></header>
    <div class="guild-voice-call">
      <div class="guild-voice-state"><span class="guild-voice-orb" data-mode="idle" aria-hidden="true"></span><div><p class="guild-voice-call-status" role="status" aria-live="polite">Listo para llamar</p><p class="guild-voice-call-hint">Habla con Sota. Tus órdenes, al momento.</p></div></div>
      <div class="guild-voice-call-actions"><button type="button" data-voice-action="mute" aria-pressed="false" hidden>Silenciar</button><button type="button" data-voice-action="end" hidden>Colgar</button><button type="button" data-voice-action="agent" aria-describedby="guild-agent-availability" disabled>Llamar a Sota</button></div>
      <p id="guild-agent-availability">Comprobando disponibilidad…</p>
      <p class="guild-voice-notice" role="status" hidden></p>
      <p class="guild-voice-activity" role="status" hidden></p>
      <button type="button" data-voice-action="stop-header" aria-label="Detener unidades" ${directMode ? '' : 'hidden'}>Detener</button>
    </div>
    <ol class="guild-voice-transcript" aria-label="Conversación" aria-live="polite"></ol>
    <form class="guild-voice-form"><label class="sr-only" for="guild-voice-command">Escribe en lugar de hablar</label><div><input id="guild-voice-command" name="command" maxlength="240" autocomplete="off" placeholder="Escribe en lugar de hablar" required><button type="submit" data-voice-action="send" aria-label="Enviar mensaje">↗</button></div></form>
    ${directMode ? '' : '<div class="guild-voice-proposal" hidden role="region" aria-label="Propuesta pendiente"><small>PAUSA TÁCTICA</small><h4></h4><ul tabindex="0" aria-label="Objetivos y coste exactos; lista desplazable"></ul><p></p><div><button type="button" data-voice-action="confirm">Confirmar</button><button type="button" data-voice-action="stop">Alto · Cancelar</button></div></div>'}
    <details class="guild-voice-local"><summary>Alternativa local y ayuda</summary><p>Sin llamada a Sota: reconoce órdenes en español y responde en texto.</p><div class="guild-voice-modes"><button type="button" data-voice-action="mic">Escuchar · Local</button><select aria-label="Motor de reconocimiento" data-voice-action="recognizer"><option value="local" disabled>Local · Preparando</option><option value="browser">Voz del navegador</option></select><select aria-label="Idioma de reconocimiento" data-voice-action="language"><option value="es-MX">Español · México</option><option value="es-ES">Español · España</option></select></div><p class="guild-voice-status" role="status" aria-live="polite" data-mode="local">Comprobando el micrófono local.</p><p class="guild-voice-native">Comprobando herramientas del navegador…</p><p>Luna recoge madera · Entrena cinco arqueros · Caballeros pesados, defiendan · Alto · Estado de la ciudad</p></details>
  </section>`;
  const panel = mount.querySelector('.guild-voice');
  const status = panel.querySelector('.guild-voice-status');
  const transcript = panel.querySelector('.guild-voice-transcript');
  const proposal = panel.querySelector('.guild-voice-proposal');
  const form = panel.querySelector('form');
  const input = form.querySelector('input');
  const orb = panel.querySelector('.guild-voice-orb');
  const callStatus = panel.querySelector('.guild-voice-call-status');
  const notice = panel.querySelector('.guild-voice-notice');
  const activity = panel.querySelector('.guild-voice-activity');
  const availability = panel.querySelector('#guild-agent-availability');
  const launcher = mount.ownerDocument.querySelector('[data-action="voice"]');
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const get = (action) => panel.querySelector(`[data-voice-action="${action}"]`);
  let microphoneActive = false, userSelectedMode = false, agentConfigured = false, agentBusy = false, muted = false, sending = false, attemptedCall = false;
  function visible(value = !panel.hidden) { const opening = value && panel.hidden; panel.hidden = !value; launcher?.setAttribute('aria-expanded', String(value)); if (opening && !agentBusy) get('close').focus({ preventScroll: true }); }
  function setMuted(value) { muted = Boolean(value); get('mute').setAttribute('aria-pressed', String(muted)); get('mute').textContent = muted ? 'Activar micrófono' : 'Silenciar'; }
  function setActivity(title) { activity.textContent = String(title || '').slice(0, 180); activity.hidden = !activity.textContent; }
  function renderCallControls() {
    get('agent').disabled = !agentConfigured || agentBusy;
    get('agent').hidden = agentBusy;
    get('agent').textContent = attemptedCall ? 'Llamar otra vez' : 'Llamar a Sota';
    get('end').hidden = !agentBusy;
    get('mute').hidden = !agentBusy;
    get('mute').disabled = panel.dataset.phase !== 'active';
    get('mic').disabled = agentBusy;
    get('recognizer').disabled = agentBusy;
    get('language').disabled = agentBusy;
    availability.hidden = agentBusy || agentConfigured;
    launcher?.classList.toggle('voice-live', agentBusy);
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
      notice.textContent = 'No se pudo enviar. Tu mensaje sigue aquí para intentarlo otra vez.';
      notice.hidden = false;
    } finally { sending = false; get('send').disabled = false; }
  }, options);
  return {
    panel, visible, setMuted, setActivity,
    setAudioLevel(level) { const value = Number(level); orb.style.setProperty('--voice-level', String(agentBusy && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0)); },
    addTranscript(text, source = 'agent') { const entry = document.createElement('li'); entry.dataset.source = source; const who = document.createElement('small'); who.textContent = ['typed', 'browser-speech', 'local-speech', 'elevenlabs-user'].includes(source) ? 'TÚ' : 'SOTA'; const line = document.createElement('span'); line.textContent = String(text).slice(0, 600); entry.append(who, line); transcript.append(entry); while (transcript.children.length > 8) transcript.firstElementChild.remove(); transcript.scrollTop = transcript.scrollHeight; },
    setLocalReady(value) { const option = get('recognizer').querySelector('[value="local"]'); option.disabled = !value.ready; option.textContent = value.ready ? 'Local · Español sin nube' : value.state === 'starting' ? 'Local · Preparando' : 'Local · No disponible'; if (!microphoneActive && !userSelectedMode) { if (value.ready) get('recognizer').value = 'local'; else if (get('recognizer').value === 'local') get('recognizer').value = 'browser'; } },
    setAgentAvailability(value) {
      agentConfigured = value.configured === true;
      const explanation = agentConfigured ? 'Sota está disponible.' : value.code === 'PERSONAL_AGENT_NOT_CONFIGURED' ? 'Sota todavía no está configurado. Puedes escribir una orden.' : 'Sota no está disponible ahora. Puedes escribir una orden.';
      availability.textContent = explanation;
      get('agent').title = explanation;
      renderCallControls();
    },
    setStatus(value) {
      if (value.mode === 'elevenlabs') {
        const connecting = ['connecting', 'reconnecting'].includes(value.state);
        agentBusy = Boolean(value.active || connecting);
        attemptedCall = true;
        panel.dataset.phase = connecting ? 'connecting' : value.active ? 'active' : 'ended';
        orb.dataset.mode = connecting ? 'connecting' : value.active ? value.state === 'speaking' ? 'speaking' : 'listening' : 'ended';
        callStatus.textContent = connecting ? value.state === 'reconnecting' ? 'Reconectando' : 'Conectando' : value.active ? value.state === 'speaking' ? 'Hablando' : 'Escuchando' : ['blocked', 'error', 'unavailable'].includes(value.state) ? 'No se pudo conectar' : 'Terminada';
        callStatus.dataset.state = value.state;
        panel.querySelector('.guild-voice-call-hint').textContent = agentBusy ? 'Tus órdenes se ejecutan al momento.' : 'Puedes volver a llamar o escribir una orden.';
        notice.textContent = !agentBusy ? value.message || '' : '';
        notice.hidden = !notice.textContent;
        if (!agentBusy) { setActivity(''); setMuted(false); orb.style.setProperty('--voice-level', '0'); }
        renderCallControls();
        return;
      }
      const mode = value.mode || get('recognizer').value;
      if (['browser','local'].includes(value.mode)) microphoneActive = Boolean(value.active);
      if (!value.mode && microphoneActive) return;
      status.textContent = `${mode === 'local' ? 'LOCAL' : 'NAVEGADOR'} · ${value.message || value.state}`; status.dataset.state = value.state; status.dataset.mode = mode;
      get('mic').textContent = microphoneActive ? `Terminar · ${mode === 'local' ? 'Local' : 'Navegador'}` : `Escuchar · ${get('recognizer').value === 'local' ? 'Local' : 'Navegador'}`;
      get('mic').setAttribute('aria-pressed', String(microphoneActive));
    },
    setNative(value) { panel.querySelector('.guild-voice-native').textContent = value.state === 'native-registered' ? `${value.registered.length} herramientas disponibles en el navegador.` : value.state === 'legacy-registered' ? `${value.registered.length} herramientas en la API anterior del navegador.` : value.state === 'registration-failed' ? `El navegador rechazó ${value.failures.length} herramientas. El texto sigue disponible.` : 'El navegador no expone herramientas nativas. Puedes usar el texto.'; },
    setProposal(value, now = Date.now()) {
      if (directMode) return;
      const pending = value && ['proposed', 'armed', 'countdown'].includes(value.state); proposal.hidden = !pending; get('stop-header').hidden = !pending;
      if (!pending) return;
      visible(true); proposal.querySelector('h4').textContent = value.action.title;
      const list = proposal.querySelector('ul'); list.replaceChildren(); for (const text of value.action.lines || []) { const item = document.createElement('li'); item.textContent = text; list.append(item); }
      proposal.querySelector('p').textContent = value.state === 'countdown' ? `${Math.max(0, Math.ceil((value.stopWindowEndsAt - now) / 1000))} s para decir Alto.` : value.state === 'armed' ? 'Confirmada. Esperando el final de la respuesta.' : 'Di Confirma para aceptar, o Alto para cancelar. Caduca en 30 segundos.';
      get('confirm').disabled = value.state !== 'proposed';
    },
    destroy() { controller.abort(); mount.replaceChildren(); }
  };
}
