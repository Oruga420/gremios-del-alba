import { createVoiceRegistry } from './registry.js';
import { parseSpanishCommand } from './spanish.js';
import { mountVoicePanel } from './panel.js';
import { createBrowserSpeech } from './speech.js';
import { createPersonalAgent } from './elevenlabs.js';
import { registerNativeTools } from './webmcp.js';
import { createLocalSpeech } from './local-speech.js';

export function initializeVoice(game) {
  window.guildVoice?.destroy?.();
  const mount = document.querySelector('#voice-mount');
  if (!mount) throw new Error('Voice mount missing');
  if (!document.querySelector('#guild-voice-style')) { const link = document.createElement('link'); link.id = 'guild-voice-style'; link.rel = 'stylesheet'; link.href = '/src/voice/voice.css'; document.head.append(link); }
  const registry = createVoiceRegistry(game);
  const status = { state: 'ready', localSpeech: { state: 'starting', ready: false, liveAudioVerified: false }, browserSpeech: { state: 'idle', liveAudioVerified: false }, elevenlabs: { state: 'unverified', liveAudioVerified: false }, native: { state: 'registering', registered: [], failures: [], provenance: 'none' }, bridge: 'application-only' };
  let speech, localSpeech, agent, native, destroyed = false, lastTerminal = null;
  let generation = game.worldGeneration;
  let microphoneMode = 'local';
  const controller = new AbortController();
  function updateStatus(value) { if (destroyed) return; if (value.mode === 'local') status.localSpeech = { ...status.localSpeech, ...value }; if (value.mode === 'browser') status.browserSpeech = { ...status.browserSpeech, ...value }; if (value.mode === 'elevenlabs') status.elevenlabs = { ...status.elevenlabs, ...value }; panel.setStatus(value); }
  function completeResponse(binding) { if (!destroyed && binding) registry.confirm.speechEnded(binding); }
  function speakResult(value, source) {
    panel.addTranscript(value.speak, 'agent'); game.announce(value.speak, !value.ok);
    // These responses are displayed with no audio output scheduled. Explicit completion
    // is neither an audio/microphone proof nor an expiry fallback.
    if (value.code === 'ARMED' && ['typed', 'browser-speech', 'local-speech'].includes(source)) completeResponse(value.data);
    return value;
  }
  function runText(text, context = { source: 'typed' }) {
    if (destroyed) return { ok: false, code: 'DISCONNECTED', speak: 'La sesión terminó.' };
    const source = context.source || 'typed'; panel.visible(true);
    if (source === 'typed' && agent?.engaged) {
      const result = agent.sendText(text);
      if (!result.ok && result.speak) panel.addTranscript(result.speak, 'agent');
      return result;
    }
    panel.addTranscript(text, source);
    let parsed;
    try { parsed = parseSpanishCommand(text, { game, confirm: registry.confirm, mode: registry.mode }); }
    catch (error) { parsed = { error: { ok: false, code: error.code || 'COMMAND_REJECTED', speak: error.code ? error.message : 'No pude resolver esa orden.' } }; }
    return speakResult(parsed.error || registry.runTool(parsed.name, parsed.input, { ...context, source }), source);
  }
  function endVoice(reason = 'disconnected') {
    registry.confirm.invalidate(reason.toUpperCase());
    if (speech?.active) speech.stop(reason);
    if (localSpeech?.active) localSpeech.stop(reason);
    if (agent?.engaged) agent.end(reason);
    return { ok: true };
  }
  function startCall(event) {
    panel.visible(true);
    if (destroyed) return { ok: false, code: 'DISCONNECTED' };
    if (status.elevenlabs.code === 'PERSONAL_VOICE_PRIVATE') return { ok: true, code: 'VOICE_PANEL_OPEN' };
    if (agent.engaged) return { ok: true, code: 'CALL_OPEN' };
    endVoice('mode-changed');
    return agent.start(event);
  }
  const panel = mountVoicePanel({ mount, directMode: registry.mode === 'direct',
    onCommand: runText,
    onMic: (event, lang, mode) => { microphoneMode = mode; if (agent?.engaged) agent.end('mode-changed'); if (mode === 'local') { if (speech.active) speech.stop('mode-changed'); localSpeech.start(event); } else { if (localSpeech.active) localSpeech.stop('mode-changed'); speech.start(event, lang); } },
    onAgent: startCall,
    onMute: (muted) => agent.setMuted(muted),
    onModeChange: (mode) => { endVoice('mode-changed'); microphoneMode = mode; panel.setStatus({ mode, state: 'idle', active: false, message: mode === 'local' ? 'Micrófono local listo. Las respuestas aparecen en texto.' : 'Reconocimiento del navegador seleccionado.' }); },
    onEnd: endVoice,
    onConfirm: () => { const pending = registry.confirm.getState(); if (pending) speakResult(registry.runTool('confirm_action', { proposalId: pending.proposalId, confirmationText: 'confirmado con el botón' }, { source: 'typed' }), 'typed'); },
    onStop: () => speakResult(registry.runTool('stop_action', {}, { source: 'typed' }), 'typed')
  });
  speech = createBrowserSpeech({ onTranscript: runText, onStatus: updateStatus, onStop: (reason) => registry.confirm.invalidate(`BROWSER_${reason.toUpperCase()}`) });
  localSpeech = createLocalSpeech({ onTranscript: runText, onStatus: updateStatus, onStop: (reason) => registry.confirm.invalidate(`LOCAL_${reason.toUpperCase()}`), getBinding: () => ({ worldGeneration: game.worldGeneration, sessionEpoch: registry.confirm.sessionEpoch, proposalId: registry.confirm.pending ? registry.confirm.getState().proposalId : null }) });
  agent = createPersonalAgent({ tools: registry.exportRegistry(), runTool: registry.runTool, confirm: registry.confirm, onStatus: updateStatus,
    onTranscript: (text, context) => { if (!destroyed) panel.addTranscript(text, context.source); },
    onAudioLevel: (level) => { if (!destroyed) panel.setAudioLevel(level); },
    onMuted: (muted) => { if (!destroyed) panel.setMuted(muted); },
    onActivity: (title) => { if (!destroyed) panel.setActivity(title); }
  });
  const unsubscribe = registry.confirm.subscribe((value) => {
    panel.setProposal(value);
    if (value && !['proposed','armed','countdown','executing'].includes(value.state) && value.proposalId !== lastTerminal) { lastTerminal = value.proposalId; if (value.result?.speak) { panel.addTranscript(value.result.speak); game.announce(value.result.speak, !value.result.ok); } }
  });
  const timer = setInterval(() => { if (registry.confirm.pending) panel.setProposal(registry.confirm.tick()); }, 100);
  function worldChanged() {
    if (generation === game.worldGeneration) return;
    generation = game.worldGeneration;
    if (speech.active) speech.stop('world-changed');
    if (agent.engaged) agent.end('world-changed');
    if (registry.confirm.state === 'executing') queueMicrotask(() => { if (localSpeech.active) localSpeech.invalidate('world-changed'); registry.confirm.invalidate('WORLD_CHANGED'); });
    else { if (localSpeech.active) localSpeech.invalidate('world-changed'); registry.confirm.invalidate('WORLD_CHANGED'); }
  }
  window.addEventListener('worldchange', worldChanged, { signal: controller.signal });
  window.addEventListener('gremios:worldchange', worldChanged, { signal: controller.signal });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') endVoice('escape'); }, { signal: controller.signal });
  window.addEventListener('pagehide', () => endVoice('disconnected'), { signal: controller.signal });
  const bridge = Object.freeze({ provenance: 'application-registry-bridge; not native WebMCP', exportRegistry: registry.exportRegistry, list: registry.exportRegistry, runTool: registry.runTool, execute: registry.runTool, run: registry.runTool });
  window.guildTools = bridge;
  const voice = { mode: registry.mode, status, confirm: registry.confirm, runText, runTool: registry.runTool, completeResponse, getAudit: registry.getAudit,
    startCall,
    toggle(event) { if (destroyed) return; if (agent.engaged) { panel.visible(panel.panel.hidden); return; } return startCall(event); },
    close() { endVoice('closed'); panel.visible(false); },
    destroy() { if (destroyed) return; destroyed = true; clearInterval(timer); controller.abort(); unsubscribe(); speech.destroy(); localSpeech.destroy(); agent.destroy(); registry.confirm.destroy(); native?.destroy(); panel.destroy(); if (window.guildTools === bridge) delete window.guildTools; }
  };
  window.guildVoice = voice;
  panel.setStatus({ mode: microphoneMode, state: 'idle', active: false, message: 'Escribe una orden o pulsa Escuchar. Las respuestas aparecen en texto.' });
  registerNativeTools({ tools: registry.exportRegistry(), runTool: registry.runTool, onStatus(value) { if (!destroyed) { status.native = value; panel.setNative(value); } } }).then((adapter) => { native = adapter; if (destroyed) adapter.destroy(); }).catch(() => { status.native = { state: 'registration-failed', provenance: 'none', registered: [], failures: [{ name: 'registration', error: 'UnexpectedFailure' }] }; panel.setNative(status.native); });
  async function refreshAgentAvailability() {
    try { const value = await (await fetch('/api/voice/status', { cache: 'no-store', signal: controller.signal })).json(); if (!destroyed) { status.elevenlabs = { ...status.elevenlabs, configured: value.configured === true, state: agent?.engaged ? status.elevenlabs.state : value.configured ? 'configured-unverified' : 'blocked', code: value.code, liveAudioVerified: false }; panel.setAgentAvailability(status.elevenlabs); } }
    catch { if (!destroyed) { status.elevenlabs = { state: 'blocked', configured: false, code: 'LOCAL_SERVER_UNAVAILABLE', liveAudioVerified: false }; panel.setAgentAvailability(status.elevenlabs); } }
  }
  refreshAgentAvailability();
  (async () => {
    for (let attempt = 0; attempt < 20 && !destroyed; attempt++) {
      try {
        const value = await (await fetch('/api/speech/status', { cache: 'no-store', signal: controller.signal })).json();
        if (destroyed) return;
        status.localSpeech = { ...status.localSpeech, ...value }; panel.setLocalReady(value);
        if (value.ready) { panel.setStatus({ state: 'ready', message: 'Reconocimiento local listo. Pulsa Escuchar y di una frase.' }); return; }
        if (value.state !== 'starting') return;
      } catch { if (!destroyed) { status.localSpeech.state = 'unavailable'; panel.setLocalReady({ ready: false }); } return; }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  })();
  return voice;
}
