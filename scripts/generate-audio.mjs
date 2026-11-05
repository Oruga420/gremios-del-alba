#!/usr/bin/env node
// Optional helper: generates the missing audio files listed in assets/audio/manifest.json with ElevenLabs.
// Usage: node --env-file-if-exists=.env scripts/generate-audio.mjs [--dry-run] [--force] [--only=sfx|voice] [--lang=es,en] [--id=ui_click,victory] [--index]
//   --dry-run  list what would be created, make no network calls
//   --force    regenerate files that already exist (overwrites them)
//   --index    only rewrite assets/audio/available.json from the files on disk (no network calls)
// Env: ELEVENLABS_API_KEY (required for generation), ELEVENLABS_VOICE_<LANG> (e.g. ELEVENLABS_VOICE_ES) or the fallback ELEVENLABS_VOICE_ID.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const audioRoot = path.join(root, 'assets', 'audio');
const API = 'https://api.elevenlabs.io/v1';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = name => { const hit = args.find(arg => arg.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3).split(',').map(s => s.trim()).filter(Boolean) : null; };
const dryRun = flag('dry-run'), force = flag('force'), indexOnly = flag('index');
const only = option('only')?.[0] || null, langs = option('lang'), ids = option('id');
const safeId = id => /^[a-z0-9_]{1,64}$/.test(id);

const exists = async file => { try { return (await stat(file)).size > 0; } catch { return false; } };

async function loadManifest() {
  const manifest = JSON.parse(await readFile(path.join(audioRoot, 'manifest.json'), 'utf8'));
  const languages = manifest.languages;
  const jobs = [];
  if (only !== 'voice') for (const item of manifest.sfx) {
    if (!safeId(item.id) || (ids && !ids.includes(item.id))) continue;
    jobs.push({ type: 'sfx', id: item.id, file: path.join(audioRoot, 'sfx', `${item.id}.mp3`), prompt: item.prompt, duration: item.duration_seconds, chars: item.prompt.length });
  }
  if (only !== 'sfx') for (const line of manifest.voice.lines) {
    if (!safeId(line.id) || (ids && !ids.includes(line.id))) continue;
    for (const lang of languages) {
      if (langs && !langs.includes(lang)) continue;
      const text = line.text?.[lang];
      if (!text) continue;
      jobs.push({ type: 'voice', id: line.id, lang, file: path.join(audioRoot, 'voice', lang, `${line.id}.mp3`), text, chars: text.length });
    }
  }
  return { manifest, languages, jobs };
}

/** Writes assets/audio/available.json so the game only requests files that exist (avoids 404 requests). */
async function writeIndex(manifest, languages) {
  const index = { generatedAt: new Date().toISOString(), sfx: [], voice: {} };
  for (const item of manifest.sfx) if (safeId(item.id) && await exists(path.join(audioRoot, 'sfx', `${item.id}.mp3`))) index.sfx.push(item.id);
  for (const lang of languages) {
    index.voice[lang] = [];
    for (const line of manifest.voice.lines) if (safeId(line.id) && await exists(path.join(audioRoot, 'voice', lang, `${line.id}.mp3`))) index.voice[lang].push(line.id);
  }
  await writeFile(path.join(audioRoot, 'available.json'), `${JSON.stringify(index, null, 2)}\n`);
  const voiceCount = Object.values(index.voice).reduce((sum, list) => sum + list.length, 0);
  console.log(`available.json: ${index.sfx.length} sfx, ${voiceCount} voice lines.`);
}

function voiceFor(lang) {
  const value = process.env[`ELEVENLABS_VOICE_${lang.toUpperCase()}`]?.trim() || process.env.ELEVENLABS_VOICE_ID?.trim();
  return value && /^[A-Za-z0-9]{8,64}$/.test(value) ? value : null;
}

async function request(url, key, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'xi-api-key': key, 'content-type': 'application/json', accept: 'audio/mpeg' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${detail.slice(0, 300)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function generate(job, key) {
  if (job.type === 'sfx') return request(`${API}/sound-generation`, key, { text: job.prompt, duration_seconds: job.duration, prompt_influence: 0.4 });
  const voice = voiceFor(job.lang);
  if (!voice) throw new Error(`no voice id: set ELEVENLABS_VOICE_${job.lang.toUpperCase()} or ELEVENLABS_VOICE_ID`);
  return request(`${API}/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, key, { text: job.text, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3 } });
}

const { manifest, languages, jobs } = await loadManifest();
if (indexOnly) { await writeIndex(manifest, languages); process.exit(0); }

const pending = [];
for (const job of jobs) if (force || !await exists(job.file)) pending.push(job);
const label = job => job.type === 'sfx' ? `sfx/${job.id}.mp3` : `voice/${job.lang}/${job.id}.mp3`;
const sfxSeconds = pending.filter(job => job.type === 'sfx').reduce((sum, job) => sum + job.duration, 0);
const ttsChars = pending.filter(job => job.type === 'voice').reduce((sum, job) => sum + job.chars, 0);

console.log(`Audio manifest: ${jobs.length} files selected, ${jobs.length - pending.length} already present, ${pending.length} to create${force ? ' (--force: existing files will be overwritten)' : ''}.`);
console.log('');
console.log('COST WARNING: every generation spends ElevenLabs credits on YOUR account.');
console.log(`  Sound effects: ${pending.filter(job => job.type === 'sfx').length} requests, ~${sfxSeconds.toFixed(1)} s of audio (billed per generation/second).`);
console.log(`  Voice lines:   ${pending.filter(job => job.type === 'voice').length} requests, ${ttsChars} characters of text-to-speech.`);
console.log('  Run with --dry-run first; failed requests are not retried automatically.');
console.log('');

if (dryRun || !pending.length) {
  for (const job of pending) console.log(`  would create ${label(job)}  ${job.type === 'sfx' ? `(${job.duration}s) ${job.prompt}` : `«${job.text}»${voiceFor(job.lang) ? '' : '  [no voice id configured]'}`}`);
  if (!pending.length && !dryRun) await writeIndex(manifest, languages);
  process.exit(0);
}

const key = process.env.ELEVENLABS_API_KEY?.trim();
if (!key) { console.error('ELEVENLABS_API_KEY is not set (add it to .env or the environment). Nothing was generated.'); process.exit(1); }

let created = 0, failed = 0;
for (const job of pending) {
  try {
    const bytes = await generate(job, key);
    await mkdir(path.dirname(job.file), { recursive: true });
    await writeFile(job.file, bytes);
    created++;
    console.log(`  created ${label(job)} (${bytes.length} bytes)`);
  } catch (error) {
    failed++;
    console.error(`  FAILED ${label(job)}: ${error.message}`);
  }
}
await writeIndex(manifest, languages);
console.log(`Done: ${created} created, ${failed} failed.`);
if (failed) process.exitCode = 1;
