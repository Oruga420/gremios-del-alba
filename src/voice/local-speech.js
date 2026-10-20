// Real microphone/MediaRecorder capture; offline recognition happens on the loopback server.
export function createLocalSpeech({ onTranscript, onStatus, onStop = () => {}, getBinding, fetcher = fetch, mediaDevices = globalThis.navigator?.mediaDevices, Recorder = globalThis.MediaRecorder, Audio = globalThis.AudioContext || globalThis.webkitAudioContext }) {
  let epoch = 0, active = false, stream = null, recorder = null, audio = null, source = null, analyser = null, monitor = null, deadline = null, idleDeadline = null, upload = null, csrf = null;
  let captureStarted = 0, lastSound = 0, heard = false, chunks = [], binding = null;
  let processing = false, queued = null;
  const now = () => performance.now();
  const sameBinding = (expected) => JSON.stringify(expected) === JSON.stringify(getBinding());
  const update = (state, message, extra = {}) => onStatus({ mode: 'local', state, active, message, ...extra });
  function releaseCapture() {
    clearInterval(monitor); monitor = null; clearTimeout(deadline); clearTimeout(idleDeadline);
    if (recorder) { recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null; if (recorder.state !== 'inactive') { try { recorder.stop(); } catch {} } recorder = null; }
    stream?.getTracks().forEach((track) => track.stop()); stream = null;
    source?.disconnect(); analyser?.disconnect(); source = null; analyser = null;
    if (audio) { audio.close().catch(() => {}); audio = null; }
    chunks = []; queued = null;
  }
  function stop(reason = 'stopped') {
    epoch++; active = false; upload?.abort(); upload = null; processing = false; releaseCapture();
    const message = reason === 'hard-cap' ? 'La escucha local terminó al llegar a 2 minutos. Puedes volver a pulsar Escuchar.' : reason === 'idle-timeout' ? 'Micrófono local detenido tras 30 segundos sin frases.' : 'Micrófono local detenido.';
    update(reason, message); onStop(reason);
  }
  async function submit(blob, capturedBinding, myEpoch) {
    if (!sameBinding(capturedBinding)) { stop('stale-world'); return; }
    processing = true;
    upload = new AbortController(); update('transcribing', 'Reconociendo la frase en este equipo…');
    try {
      const response = await fetcher('/api/speech', { method: 'POST', headers: { 'Content-Type': blob.type.split(';')[0], 'X-Guild-CSRF': csrf }, body: blob, signal: upload.signal });
      const value = await response.json();
      if (myEpoch !== epoch || !active) return;
      if (!sameBinding(capturedBinding)) { stop('stale-world'); return; }
      if (!response.ok || !value.ok || !value.transcript) { stop('error'); update('error', value.message || 'No reconocí la frase. Inténtalo de nuevo.'); return; }
      onTranscript(value.transcript, { source: 'local-speech', final: true, engine: value.engine, durationSeconds: value.durationSeconds });
      if (myEpoch === epoch && active) { clearTimeout(idleDeadline); idleDeadline = setTimeout(() => stop('idle-timeout'), 30_000); }
    } catch (error) { if (myEpoch === epoch && active) { stop('error'); update('error', error.name === 'AbortError' ? 'Reconocimiento cancelado.' : 'Falló el reconocimiento local. Puedes escribir la orden.'); } }
    finally { if (myEpoch === epoch) { upload = null; processing = false; const next = queued; queued = null; if (next && active) submit(next.blob, next.binding, myEpoch); } }
  }
  function beginUtterance(myEpoch) {
    if (!active || myEpoch !== epoch || !stream) return;
    chunks = []; heard = false; captureStarted = now(); lastSound = captureStarted; binding = getBinding();
    const type = ['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/webm'].find((value) => Recorder.isTypeSupported(value));
    if (!type) { stop('unavailable'); update('unavailable', 'Este navegador no puede grabar el formato local. Usa la alternativa del navegador o el texto.'); return; }
    const current = new Recorder(stream, { mimeType: type, audioBitsPerSecond: 96000 }); recorder = current;
    current.ondataavailable = (event) => { if (myEpoch === epoch && event.data.size) chunks.push(event.data); };
    current.onerror = () => { if (myEpoch === epoch) { stop('error'); update('error', 'No se pudo grabar el micrófono.'); } };
    current.onstop = () => {
      clearInterval(monitor); monitor = null;
      if (myEpoch !== epoch || !active) return;
      recorder = null;
      const blob = new Blob(chunks, { type }), capturedBinding = binding, capturedSpeech = heard; chunks = [];
      if (capturedSpeech && blob.size) {
        if (!processing) submit(blob, capturedBinding, myEpoch);
        else if (!queued) queued = { blob, binding: capturedBinding };
        else { stop('busy'); update('busy', 'Demasiadas frases seguidas. Pulsa Escuchar e inténtalo de nuevo.'); return; }
      }
      // Keep capturing while the previous utterance is decoded. Dropping the
      // microphone here loses the start of Confirma/Alto during recognition.
      beginUtterance(myEpoch);
    };
    current.start(); update('listening', 'Escuchando localmente. Di una frase y haz una pausa.');
    const samples = new Float32Array(analyser.fftSize);
    monitor = setInterval(() => {
      if (myEpoch !== epoch || !active || current.state !== 'recording') return;
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      if (rms > .018) { if (!heard) binding = getBinding(); heard = true; lastSound = now(); }
      if ((heard && now() - lastSound > 350) || now() - captureStarted > 6000) current.stop();
    }, 50);
  }
  async function start(event) {
    if (event?.isTrusted !== true) { update('gesture-required', 'Pulsa Escuchar para autorizar el micrófono.'); return false; }
    if (active) { stop(); return false; }
    if (!mediaDevices?.getUserMedia || !Recorder || !Audio) { update('unavailable', 'La grabación local no está disponible en este navegador.'); return false; }
    const myEpoch = ++epoch; active = true; update('starting', 'Solicitando el micrófono para reconocimiento local…');
    try {
      upload = new AbortController();
      const session = await (await fetcher('/api/session', { cache: 'no-store', signal: upload.signal })).json();
      if (myEpoch !== epoch || !active) return false;
      csrf = session.csrf; upload = null;
      const acquired = await mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (myEpoch !== epoch || !active) { acquired.getTracks().forEach((track) => track.stop()); return false; }
      stream = acquired; const currentAudio = new Audio(); audio = currentAudio; await currentAudio.resume();
      if (myEpoch !== epoch || !active) { acquired.getTracks().forEach((track) => track.stop()); currentAudio.close().catch(() => {}); return false; }
      source = audio.createMediaStreamSource(stream); analyser = audio.createAnalyser(); analyser.fftSize = 1024; source.connect(analyser);
      deadline = setTimeout(() => stop('hard-cap'), 120_000); idleDeadline = setTimeout(() => stop('idle-timeout'), 30_000);
      beginUtterance(myEpoch); return true;
    } catch (error) { if (myEpoch === epoch) { stop(error.name === 'NotAllowedError' ? 'denied' : 'error'); update(error.name === 'NotAllowedError' ? 'denied' : 'error', error.name === 'NotAllowedError' ? 'Permiso de micrófono denegado. Puedes escribir órdenes.' : 'No se pudo abrir el micrófono local.'); } return false; }
  }
  return { start, stop, invalidate: stop, destroy: () => stop('disconnected'), get active() { return active; } };
}
