import { status as said } from './i18n.js';

const ERRORS = { 'not-allowed': 'voice.speech.error.notAllowed', 'service-not-allowed': 'voice.speech.error.serviceNotAllowed', 'audio-capture': 'voice.speech.error.audioCapture', network: 'voice.speech.error.network', 'no-speech': 'voice.speech.error.noSpeech', aborted: 'voice.speech.error.aborted', 'language-not-supported': 'voice.speech.error.languageNotSupported' };
/** Recognition languages offered per interface language; the first is the default. */
export const SPEECH_LANGUAGES = Object.freeze({ es: ['es-MX', 'es-ES'], en: ['en-US', 'en-GB'], pt: ['pt-BR', 'pt-PT'], ja: ['ja-JP'], ar: ['ar-SA', 'ar-EG'], de: ['de-DE', 'de-AT'], fr: ['fr-FR', 'fr-CA'] });
const SUPPORTED = new Set(Object.values(SPEECH_LANGUAGES).flat());

export function createBrowserSpeech({ onTranscript, onStatus, onStop = () => {}, recognitionClass = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition }) {
  let recognition = null;
  let epoch = 0;
  let active = false;
  let denied = false;
  function stop(reason = 'stopped') {
    epoch++; active = false;
    if (recognition) { recognition.onresult = null; recognition.onerror = null; recognition.onend = null; recognition.onstart = null; try { recognition.abort(); } catch { /* Already inactive. */ } recognition = null; }
    onStatus({ mode: 'browser', state: reason, active: false, ...said('voice.speech.stopped') });
    onStop(reason);
  }
  function start(event, lang = 'es-MX') {
    if (event?.isTrusted !== true) { onStatus({ mode: 'browser', state: 'gesture-required', active: false, ...said('voice.speech.gestureRequired') }); return false; }
    if (!recognitionClass) { onStatus({ mode: 'browser', state: 'unavailable', active: false, ...said('voice.speech.unavailable') }); return false; }
    if (active) { stop(); return false; }
    denied = false; active = true; const myEpoch = ++epoch;
    const current = new recognitionClass(); recognition = current;
    // The panel offers the languages of the active interface locale (SPEECH_LANGUAGES); unknown tags fall back to es-MX.
    current.lang = SUPPORTED.has(lang) ? lang : 'es-MX'; current.continuous = true; current.interimResults = true; current.maxAlternatives = 1;
    const seen = new Set();
    current.onstart = () => { if (myEpoch === epoch) onStatus({ mode: 'browser', state: 'listening', active: true, ...said('voice.speech.listeningIn', { language: current.lang }) }); };
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
      onStatus({ mode: 'browser', state: denied ? 'denied' : 'error', active: false, error: code, ...said(ERRORS[code] || 'voice.speech.error.unknown') });
    };
    current.onend = () => {
      if (myEpoch !== epoch) return;
      // Never restart automatically: each new capture requires the visible click.
      stop(denied ? 'denied' : 'ended');
    };
    try { current.start(); onStatus({ mode: 'browser', state: 'starting', active: true, ...said('voice.speech.requesting') }); return true; }
    catch { stop('error'); onStatus({ mode: 'browser', state: 'error', active: false, ...said('voice.speech.startFailed') }); return false; }
  }
  return { start, stop, get active() { return active; }, get available() { return Boolean(recognitionClass); }, destroy: () => stop('disconnected') };
}
