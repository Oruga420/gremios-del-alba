import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

export const SPEECH_LIMITS = Object.freeze({ bytes: 1_048_576, duration: 8, decodeMs: 5000, recognitionMs: 5000, perSession: 60, global: 120, windowMs: 600_000 });
const contained = (root, target) => { const relative = path.relative(root, target); return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative); };
const error = (code) => Object.assign(new Error(code), { code });
function audioFormat(bytes, contentType) {
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE' && contentType === 'audio/wav') return 'wav';
  if (bytes.subarray(0, 4).toString('hex') === '1a45dfa3' && contentType === 'audio/webm') return 'matroska';
  if (bytes.subarray(0, 4).toString() === 'OggS' && contentType === 'audio/ogg') return 'ogg';
  throw error('AUDIO_FORMAT_REJECTED');
}
function decode(ffmpeg, args, signal) {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpeg, args, { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'ignore'] });
    let finished = false;
    const settle = (failure) => { if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted); failure ? reject(error(failure)) : resolve(); };
    let cancellation = null;
    const aborted = () => { cancellation = 'ABORTED'; process.kill(); };
    const timer = setTimeout(() => { cancellation = 'AUDIO_DECODE_TIMEOUT'; process.kill(); }, SPEECH_LIMITS.decodeMs);
    signal?.addEventListener('abort', aborted, { once: true });
    process.once('error', () => settle('AUDIO_DECODER_UNAVAILABLE'));
    process.once('close', (code) => settle(cancellation || (code === 0 ? null : 'AUDIO_FORMAT_REJECTED')));
    if (signal?.aborted) aborted();
  });
}

export function createLocalSpeechService(root, environment = process.env) {
  const pythonPath = environment.GUILD_PYTHON_PATH;
  const ffmpegPath = environment.GUILD_FFMPEG_PATH;
  const modelPath = path.resolve(root, environment.GUILD_VOSK_MODEL_PATH || '.local/voice/models/vosk-model-small-es-0.42');
  const tempBase = path.join(root, '.local/speech/tmp');
  let worker = null, readyPromise = null, ready = false, closed = false, serial = 0, pending = null;
  let state = 'starting';
  const status = () => ({ ready, state, local: true, model: 'vosk-model-small-es-0.42', language: 'es', license: 'Apache-2.0', maxAudioSeconds: SPEECH_LIMITS.duration, humanMicrophoneVerified: false });
  async function start() {
    if (closed) throw error('LOCAL_ASR_UNAVAILABLE');
    if (ready) return;
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      try {
        if (!pythonPath || !ffmpegPath || !path.isAbsolute(pythonPath) || !path.isAbsolute(ffmpegPath)) throw error('LOCAL_ASR_UNAVAILABLE');
        await Promise.all([access(pythonPath), access(ffmpegPath), access(path.join(modelPath, 'am/final.mdl'))]);
        if (!environment.GUILD_VOSK_MODEL_PATH && !contained(root, await realpath(modelPath))) throw error('MODEL_PATH_REJECTED');
        await mkdir(tempBase, { recursive: true });
        if (!contained(root, await realpath(tempBase))) throw error('AUDIO_PATH_REJECTED');
        await new Promise((resolve, reject) => {
          const child = spawn(pythonPath, ['-u', path.join(root, 'scripts/local-speech-worker.py')], { cwd: root, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'], env: { ...process.env, GUILD_VOSK_MODEL_PATH: modelPath, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' } });
          worker = child; state = 'starting';
          const timer = setTimeout(() => { child.kill(); reject(error('LOCAL_ASR_START_TIMEOUT')); }, 10_000);
          const lines = createInterface({ input: child.stdout });
          lines.on('line', (line) => {
            if (line.length > 4096) return;
            let message; try { message = JSON.parse(line); } catch { return; }
            if (message.ready && worker === child) { clearTimeout(timer); ready = true; state = 'ready'; resolve(); }
            else if (pending && message.id === pending.id && worker === child) { const job = pending; pending = null; job.finish(message.ok ? null : 'LOCAL_ASR_FAILED', message); }
          });
          const failed = () => { clearTimeout(timer); if (worker === child) { ready = false; worker = null; state = closed ? 'closed' : 'unavailable'; if (pending) { const job = pending; pending = null; job.finish('LOCAL_ASR_UNAVAILABLE'); } } reject(error('LOCAL_ASR_UNAVAILABLE')); lines.close(); };
          child.once('error', failed); child.once('close', failed); child.stdin.on('error', failed);
        });
      } catch { state = 'unavailable'; ready = false; throw error('LOCAL_ASR_UNAVAILABLE'); }
      finally { readyPromise = null; }
    })();
    return readyPromise;
  }
  async function transcribe(bytes, contentType, { signal } = {}) {
    if (!bytes.length || bytes.length > SPEECH_LIMITS.bytes) throw error('AUDIO_BODY_LIMIT');
    const format = audioFormat(bytes, contentType);
    await start();
    if (signal?.aborted) throw error('ABORTED');
    const directory = await mkdtemp(path.join(tempBase, 'utterance-'));
    if (!contained(await realpath(tempBase), await realpath(directory))) throw error('AUDIO_PATH_REJECTED');
    try {
      const input = path.join(directory, 'input.audio'), output = path.join(directory, 'decoded.wav');
      await writeFile(input, bytes);
      await decode(ffmpegPath, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe', '-f', format, '-i', input, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-t', '8.1', '-c:a', 'pcm_s16le', '-y', output], signal);
      const decoded = await readFile(output);
      let dataSize = 0;
      for (let cursor = 12; cursor + 8 <= decoded.length;) { const size = decoded.readUInt32LE(cursor + 4); if (decoded.subarray(cursor, cursor + 4).toString() === 'data') { dataSize = Math.min(size, decoded.length - cursor - 8); break; } cursor += 8 + size + (size % 2); }
      if (dataSize / 32000 > SPEECH_LIMITS.duration) throw error('AUDIO_TOO_LONG');
      if (dataSize < 1600) throw error('AUDIO_TOO_SHORT');
      if (signal?.aborted) throw error('ABORTED');
      const value = await new Promise((resolve, reject) => {
        if (pending) return reject(error('ASR_BUSY'));
        const id = ++serial;
        const finish = (code, value) => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); code ? reject(error(code)) : resolve(value); };
        const stopWorker = (code) => { const child = worker; pending = null; ready = false; if (child) { child.once('close', () => finish(code)); child.kill(); } else finish(code); };
        const aborted = () => stopWorker('ABORTED');
        const timer = setTimeout(() => stopWorker('LOCAL_ASR_TIMEOUT'), SPEECH_LIMITS.recognitionMs);
        pending = { id, finish }; signal?.addEventListener('abort', aborted, { once: true });
        worker.stdin.write(`${JSON.stringify({ id, file: output })}\n`);
      });
      return { transcript: value.transcript, durationSeconds: value.durationSeconds, inferenceSeconds: value.inferenceSeconds, engine: 'vosk', model: 'vosk-model-small-es-0.42', cloud: false };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  start().catch(() => {});
  return { start, status, transcribe, async close() { closed = true; ready = false; state = 'closed'; worker?.kill(); if (pending) { pending.finish('ABORTED'); pending = null; } } };
}
