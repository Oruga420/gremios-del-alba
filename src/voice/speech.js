const ERRORS = { 'not-allowed': 'Permiso de micrófono denegado. Actívalo en el navegador y vuelve a pulsar Escuchar.', 'service-not-allowed': 'El navegador no permite su servicio de reconocimiento.', 'audio-capture': 'No encontré un micrófono disponible.', network: 'Falló la conexión del reconocimiento del navegador.', 'no-speech': 'No escuché una frase. Pulsa Escuchar para intentar otra vez.', aborted: 'Escucha detenida.', 'language-not-supported': 'Este navegador no admite reconocimiento en español.' };

export function createBrowserSpeech({ onTranscript, onStatus, onStop = () => {}, recognitionClass = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition }) {
  let recognition = null;
  let epoch = 0;
  let active = false;
  let denied = false;
  function stop(reason = 'stopped') {
    epoch++; active = false;
    if (recognition) { recognition.onresult = null; recognition.onerror = null; recognition.onend = null; recognition.onstart = null; try { recognition.abort(); } catch { /* Already inactive. */ } recognition = null; }
    onStatus({ mode: 'browser', state: reason, active: false, message: 'Escucha detenida.' });
    onStop(reason);
  }
  function start(event, lang = 'es-MX') {
    if (event?.isTrusted !== true) { onStatus({ mode: 'browser', state: 'gesture-required', active: false, message: 'Pulsa Escuchar para autorizar el micrófono.' }); return false; }
    if (!recognitionClass) { onStatus({ mode: 'browser', state: 'unavailable', active: false, message: 'Reconocimiento del navegador no disponible. Puedes escribir órdenes.' }); return false; }
    if (active) { stop(); return false; }
    denied = false; active = true; const myEpoch = ++epoch;
    const current = new recognitionClass(); recognition = current;
    current.lang = lang === 'es-ES' ? 'es-ES' : 'es-MX'; current.continuous = true; current.interimResults = true; current.maxAlternatives = 1;
    const seen = new Set();
    current.onstart = () => { if (myEpoch === epoch) onStatus({ mode: 'browser', state: 'listening', active: true, message: `Escuchando en ${current.lang}.` }); };
    current.onresult = (result) => {
      if (myEpoch !== epoch || !active) return;
      for (let index = result.resultIndex; index < result.results.length; index++) {
        if (myEpoch !== epoch || !active) return;
        const entry = result.results[index]; const transcript = String(entry[0]?.transcript || '').trim();
        if (!entry.isFinal) { onStatus({ mode: 'browser', state: 'interim', active: true, message: transcript }); continue; }
        if (!seen.has(index) && transcript) { seen.add(index); onTranscript(transcript, { source: 'browser-speech', lang: current.lang, final: true }); }
      }
    };
    current.onerror = (error) => {
      if (myEpoch !== epoch) return;
      const code = String(error.error || 'unknown'); denied = ['not-allowed', 'service-not-allowed'].includes(code);
      stop(denied ? 'denied' : 'error');
      onStatus({ mode: 'browser', state: denied ? 'denied' : 'error', active: false, error: code, message: ERRORS[code] || 'No pude reconocer la frase. Puedes escribirla.' });
    };
    current.onend = () => {
      if (myEpoch !== epoch) return;
      // Never restart automatically: each new capture requires the visible click.
      stop(denied ? 'denied' : 'ended');
    };
    try { current.start(); onStatus({ mode: 'browser', state: 'starting', active: true, message: 'Solicitando el micrófono…' }); return true; }
    catch { stop('error'); onStatus({ mode: 'browser', state: 'error', active: false, message: 'No se pudo iniciar el micrófono. Puedes escribir órdenes.' }); return false; }
  }
  return { start, stop, get active() { return active; }, get available() { return Boolean(recognitionClass); }, destroy: () => stop('disconnected') };
}
