/**
 * Optional, asset-driven audio. Sound effects live in assets/audio/sfx/<id>.mp3 and announcer
 * lines in assets/audio/voice/<lang>/<id>.mp3 (see assets/audio/manifest.json). Every file is
 * optional: a missing file is requested at most once per session and then stays silent.
 * The game is observed from the outside (world events, the combat journal and state diffs),
 * so the simulation and src/app.js need no changes beyond calling installAudio(game).
 * Importing this module never touches window/document; only installAudio() does.
 */
import { t, getLocale, onLocaleChange } from '../i18n/index.js';
import { BUILDINGS, UNITS } from '../game/data.js';

export const SFX_IDS = Object.freeze(['ui_click', 'ui_open_panel', 'build_place', 'build_complete', 'train_complete', 'research_complete', 'age_up', 'gather_wood', 'gather_stone', 'sword_hit', 'arrow_shot', 'fireball', 'heal', 'conversion', 'unit_death', 'building_destroyed', 'victory', 'defeat', 'under_attack_horn']);
export const VOICE_IDS = Object.freeze(['match_start', 'building_complete', 'unit_ready', 'research_complete', 'age_up', 'under_attack', 'unit_converted', 'victory', 'defeat', 'population_full', 'not_enough_resources']);

/**
 * World event kind -> audio. `own` means the world emits the event for both teams, so it only
 * plays when the state watcher confirms the same change happened to the player (team 1).
 * `start` plays only for the opening event of a new match.
 */
export const EVENT_AUDIO = Object.freeze({
  info: Object.freeze({ voice: 'match_start', start: true }),
  build: Object.freeze({ sfx: 'build_complete', voice: 'building_complete', own: true }),
  combat: Object.freeze({ sfx: 'unit_death', buildingSfx: 'building_destroyed' }),
  research: Object.freeze({ sfx: 'research_complete', voice: 'research_complete', own: true }),
  age: Object.freeze({ sfx: 'age_up', voice: 'age_up', own: true }),
  convert: Object.freeze({ sfx: 'conversion', voice: 'unit_converted', own: true }),
  victory: Object.freeze({ sfx: 'victory', voice: 'victory' }),
  defeat: Object.freeze({ sfx: 'defeat', voice: 'defeat' }),
});
/** Combat journal kinds (world.combatEvents) -> audio. */
export const COMBAT_AUDIO = Object.freeze({ attack: 'attack', hit: 'hit', cast: 'cast', support: 'support', death: 'unit_death' });

export const AUDIO_ROOT = '/assets/audio/';
export const sfxPath = id => `${AUDIO_ROOT}sfx/${id}.mp3`;
export const voicePath = (id, lang) => `${AUDIO_ROOT}voice/${lang}/${id}.mp3`;

const STORAGE_KEY = 'gremios-audio';
const PANEL_ACTIONS = new Set(['help', 'roster', 'market', 'research', 'save', 'load', 'new-match']);
const SFX_GAIN = { ui_click: .45, ui_open_panel: .55, gather_wood: .35, gather_stone: .35, sword_hit: .5, arrow_shot: .45, unit_death: .55, heal: .5 };
const COMBAT_SFX = new Set(['sword_hit', 'arrow_shot', 'fireball', 'heal', 'unit_death']);
const VOICE_COOLDOWN = { under_attack: 20000, population_full: 30000, not_enough_resources: 8000, unit_ready: 6000, building_complete: 4000, research_complete: 3000, unit_converted: 5000 };
const VOICE_GAP = 2500;
const GATHER_GAP = 7000;
const COMBAT_WINDOW = 1000, COMBAT_MAX = 4, SAME_SFX_GAP = 120;
const POLL_MS = 100;

const nowMs = () => globalThis.performance?.now?.() ?? Date.now();

/**
 * Pure watcher: turns world observations into cue() calls. No DOM, testable in Node.
 * cue({sfx?, voice?}) is called for every sound the game should make; throttling of combat and
 * voice frequency happens here so it is deterministic and covered by tests.
 */
export function createAudioWatcher(cue, { clock = nowMs } = {}) {
  let world = null, seenEvents = new WeakSet(), lastCombatSeq = 0, snapshot = null;
  let lastUnderAttack = -Infinity, lastGather = -Infinity, combatTimes = [], lastSfxAt = new Map();
  const voiceAt = new Map();
  let lastVoice = -Infinity;

  function emitSfx(id, now = clock()) {
    if (!id) return;
    if (COMBAT_SFX.has(id)) {
      combatTimes = combatTimes.filter(time => now - time < COMBAT_WINDOW);
      if (combatTimes.length >= COMBAT_MAX) return;
      combatTimes.push(now);
    }
    if (now - (lastSfxAt.get(id) ?? -Infinity) < SAME_SFX_GAP) return;
    lastSfxAt.set(id, now);
    cue({ sfx: id });
  }
  function emitVoice(id, now = clock()) {
    if (!id) return;
    if (now - lastVoice < VOICE_GAP && !['victory', 'defeat'].includes(id)) return;
    if (now - (voiceAt.get(id) ?? -Infinity) < (VOICE_COOLDOWN[id] ?? 0)) return;
    voiceAt.set(id, now); lastVoice = now;
    cue({ voice: id });
  }

  function takeSnapshot(state) {
    const units = new Map(), buildings = new Map();
    for (const u of state.units || []) if (u && u.hp > 0) units.set(u.id, u.team);
    for (const b of state.buildings || []) if (b && b.team === 1 && b.hp > 0) buildings.set(b.id, { progress: b.progress, paused: b.queuePaused || null });
    const team = state.teams?.[1] || {};
    return { units, buildings, upgrades: new Set(Object.keys(team.upgrades || {}).filter(key => team.upgrades[key])), age: Number(team.age) || 1, wood: Number(team.resources?.wood) || 0, stone: Number(team.resources?.stone) || 0 };
  }

  function reset(next = null) {
    world = next; seenEvents = new WeakSet(); snapshot = null;
    lastCombatSeq = next?.combatSequence || 0;
    const state = next?.state;
    if (!state) return;
    // A fresh match replays its opening events (the start line); a loaded chronicle does not replay history.
    const fresh = Number(state.time) < 1;
    for (const event of state.events || []) if (!fresh && event && typeof event === 'object') seenEvents.add(event);
    snapshot = takeSnapshot(state);
  }

  function diff(state) {
    const next = takeSnapshot(state), prev = snapshot, own = { build: 0, research: 0, age: 0, convert: 0 };
    snapshot = next;
    if (!prev) return own;
    let placed = false, trained = false, housing = false;
    for (const [id, team] of next.units) {
      if (team !== 1) continue;
      const before = prev.units.get(id);
      if (before === undefined) trained = true;
      else if (before !== 1) own.convert++;
    }
    for (const [id, b] of next.buildings) {
      const before = prev.buildings.get(id);
      if (!before) { if (b.progress < 1) placed = true; else own.build++; continue; }
      if (before.progress < 1 && b.progress >= 1) own.build++;
      if (b.paused === 'housing' && before.paused !== 'housing') housing = true;
    }
    for (const key of next.upgrades) if (!prev.upgrades.has(key)) own.research++;
    if (next.age > prev.age) own.age += next.age - prev.age;
    const now = clock();
    if (placed) emitSfx('build_place', now);
    if (trained) { emitSfx('train_complete', now); emitVoice('unit_ready', now); }
    if (housing) emitVoice('population_full', now);
    const gainedWood = next.wood > prev.wood, gainedStone = next.stone > prev.stone;
    if ((gainedWood || gainedStone) && now - lastGather >= GATHER_GAP) { lastGather = now; emitSfx(gainedWood ? 'gather_wood' : 'gather_stone', now); }
    return own;
  }

  function events(state, own) {
    const list = state.events || [];
    const now = clock();
    for (const event of list) {
      if (!event || typeof event !== 'object' || seenEvents.has(event)) continue;
      seenEvents.add(event);
      const map = EVENT_AUDIO[event.kind];
      if (!map) continue;
      if (map.start) { if (event.i18n?.key === 'world.event.start' && Number(event.time) < 1) emitVoice(map.voice, now); continue; }
      if (map.own) { if (!(own[event.kind] > 0)) continue; own[event.kind]--; }
      const kind = event.i18n?.params?.entity?.kind;
      emitSfx(kind && BUILDINGS[kind] && map.buildingSfx ? map.buildingSfx : map.sfx, now);
      if (map.voice) emitVoice(map.voice, now);
    }
  }

  function combat(target) {
    const journal = target.combatEvents, seq = target.combatSequence || 0;
    if (!Array.isArray(journal) || seq <= lastCombatSeq) { lastCombatSeq = Math.min(lastCombatSeq, seq); return; }
    const from = Math.max(lastCombatSeq + 1, seq - journal.length + 1);
    lastCombatSeq = seq;
    const now = clock();
    for (let s = from; s <= seq; s++) {
      const entry = journal[(s - 1) % journal.length];
      if (!entry || entry.seq !== s) continue;
      const source = entry.source, victim = entry.target;
      const sourceDef = source ? UNITS[source.kind] : null;
      if (entry.kind === 'attack') { if (sourceDef?.projectile) emitSfx(source.kind === 'mage' ? 'fireball' : 'arrow_shot', now); }
      else if (entry.kind === 'hit') {
        if (!sourceDef?.projectile) emitSfx('sword_hit', now);
        if (victim?.team === 1 && source?.team === 2 && now - lastUnderAttack >= VOICE_COOLDOWN.under_attack) {
          lastUnderAttack = now; emitSfx('under_attack_horn', now); emitVoice('under_attack', now);
        }
      } else if (entry.kind === 'cast') emitSfx(source?.kind === 'healer' ? 'heal' : 'fireball', now);
      else if (entry.kind === 'support') { if (entry.amount > 0) emitSfx('heal', now); }
      else if (entry.kind === 'death') emitSfx(COMBAT_AUDIO.death, now);
    }
  }

  return {
    reset,
    voice: emitVoice,
    sfx: emitSfx,
    /** Observe the current world; call once per frame (or less). */
    poll(target) {
      if (!target?.state) { if (world) reset(null); return; }
      if (target !== world) reset(target);
      const own = diff(target.state);
      events(target.state, own);
      combat(target);
    },
  };
}

function readSettings() {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) || 'null');
    if (raw && typeof raw === 'object') return { muted: raw.muted === true, volume: Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : .8 };
  } catch {}
  return { muted: false, volume: .8 };
}
function writeSettings(settings) { try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch {} }

/** WebAudio player with per-URL caching. Missing/undecodable files resolve to null once and are never requested again. */
function createPlayer(settings) {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  let context = null, master = null, unlocked = false, available, availablePromise = null, currentVoice = null;
  const buffers = new Map();

  function ensureContext() {
    if (context || !AudioContextClass) return context;
    try { context = new AudioContextClass(); master = context.createGain(); master.connect(context.destination); applyVolume(); } catch { context = null; }
    return context;
  }
  function applyVolume() { if (master) master.gain.value = settings.muted ? 0 : settings.volume; }
  function unlock() {
    unlocked = true;
    const ctx = ensureContext();
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  }
  // Optional index written by scripts/generate-audio.mjs: when present, only listed files are requested (no 404s at all).
  function index() {
    if (available !== undefined) return Promise.resolve(available);
    availablePromise ||= fetch(`${AUDIO_ROOT}available.json`, { cache: 'no-cache' })
      .then(response => response.ok ? response.json() : null)
      .then(json => (json && typeof json === 'object' ? json : null), () => null)
      .catch(() => null)
      .then(json => { available = json; return json; });
    return availablePromise;
  }
  async function listed(kind, id, lang) {
    const json = await index();
    if (!json) return true;
    if (kind === 'sfx') return Array.isArray(json.sfx) && json.sfx.includes(id);
    return Array.isArray(json.voice?.[lang]) && json.voice[lang].includes(id);
  }
  function load(url, kind, id, lang) {
    if (buffers.has(url)) return buffers.get(url);
    const promise = listed(kind, id, lang)
      .then(ok => ok ? fetch(url) : null)
      .then(response => response?.ok && !/text\/html/i.test(response.headers.get('content-type') || '') ? response.arrayBuffer() : null)
      .then(bytes => bytes && context ? new Promise(resolve => {
        try { const result = context.decodeAudioData(bytes, resolve, () => resolve(null)); result?.catch?.(() => resolve(null)); } catch { resolve(null); }
      }) : null)
      .catch(() => null);
    buffers.set(url, promise);
    return promise;
  }
  async function play(url, kind, id, lang, gain = 1) {
    if (settings.muted || !unlocked || !ensureContext()) return null;
    const buffer = await load(url, kind, id, lang);
    if (!buffer || settings.muted || context.state !== 'running') return null;
    try {
      const source = context.createBufferSource(), level = context.createGain();
      level.gain.value = gain; source.buffer = buffer; source.connect(level); level.connect(master); source.start();
      return source;
    } catch { return null; }
  }
  return {
    unlock, applyVolume,
    sfx(id) { return play(sfxPath(id), 'sfx', id, null, SFX_GAIN[id] ?? .7); },
    async voice(id) {
      const lang = getLocale();
      const source = await play(voicePath(id, lang), 'voice', id, lang, 1);
      if (!source) return;
      try { currentVoice?.stop(); } catch {}
      currentVoice = source;
      source.onended = () => { if (currentVoice === source) currentVoice = null; };
    },
    stopAll() { try { currentVoice?.stop(); } catch {} currentVoice = null; },
  };
}

const SPEAKER_SYMBOLS = '<symbol id="i-sound" viewBox="0 0 24 24"><path d="M3 9h4l6-5v16l-6-5H3Z"/><path d="M16 8.5a5 5 0 0 1 0 7M19 5.5a9 9 0 0 1 0 13"/></symbol><symbol id="i-sound-off" viewBox="0 0 24 24"><path d="M3 9h4l6-5v16l-6-5H3Z"/><path d="m16 9 6 6m0-6-6 6"/></symbol>';

/** Installs audio for the running app. Safe to call once; returns a small control API (also at window.gremiosAudio). */
export function installAudio(game) {
  const document = globalThis.document, window = globalThis.window;
  if (!document || !window || globalThis.gremiosAudio) return globalThis.gremiosAudio || null;
  const settings = readSettings();
  const player = createPlayer(settings);
  const watcher = createAudioWatcher(cue => { if (cue.sfx) player.sfx(cue.sfx); if (cue.voice) player.voice(cue.voice); });
  let button = null;

  const status = key => { const live = document.getElementById('screen-reader-status'); if (live) live.textContent = t(key); };
  function refreshButton() {
    if (!button) return;
    const prefix = settings.muted ? 'audio.toggle.unmute' : 'audio.toggle.mute';
    button.title = t(`${prefix}.title`);
    button.setAttribute('aria-label', t(`${prefix}.label`));
    button.querySelector('use')?.setAttribute('href', settings.muted ? '#i-sound-off' : '#i-sound');
  }
  function setMuted(muted) {
    settings.muted = Boolean(muted); writeSettings(settings); player.applyVolume();
    if (settings.muted) player.stopAll();
    refreshButton(); status(settings.muted ? 'audio.status.muted' : 'audio.status.unmuted');
  }
  function setVolume(volume) { settings.volume = Math.min(1, Math.max(0, Number(volume) || 0)); writeSettings(settings); player.applyVolume(); }
  const toggle = () => setMuted(!settings.muted);

  function mountButton() {
    const library = document.querySelector('svg.svg-library');
    if (library && !document.getElementById('i-sound')) library.insertAdjacentHTML('beforeend', SPEAKER_SYMBOLS);
    const actions = document.querySelector('.game-topbar .top-actions') || document.querySelector('.top-actions');
    if (!actions || actions.querySelector('[data-audio-toggle]')) return;
    button = document.createElement('button');
    button.type = 'button'; button.className = 'icon-button'; button.dataset.audioToggle = '';
    button.innerHTML = '<svg aria-hidden="true"><use href="#i-sound"/></svg>';
    button.addEventListener('click', toggle);
    const anchor = actions.querySelector('[data-action="save"]');
    actions.insertBefore(button, anchor || null);
    refreshButton();
  }

  const unlock = () => player.unlock();
  document.addEventListener('pointerdown', unlock, { capture: true, passive: true });
  document.addEventListener('keydown', unlock, { capture: true, passive: true });
  document.addEventListener('click', event => {
    const target = event.target?.closest?.('button');
    if (!target || target.disabled || target === button) return;
    watcher.sfx(PANEL_ACTIONS.has(target.dataset.action) ? 'ui_open_panel' : 'ui_click');
  }, true);
  // M toggles sound (src/app.js does not bind M). Ignored while typing or with modifiers.
  document.addEventListener('keydown', event => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || String(event.key).toLowerCase() !== 'm') return;
    const target = event.target;
    if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
    toggle();
  });
  // Rejected commands surface as error announcements; match the localized "not enough resources" text.
  const announcements = document.getElementById('announcements');
  if (announcements && globalThis.MutationObserver) new MutationObserver(records => {
    const wanted = t('world.fail.insufficientResources');
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType === 1 && node.classList?.contains('error') && node.textContent === wanted) watcher.voice('not_enough_resources');
    }
  }).observe(announcements, { childList: true });

  window.addEventListener('worldchange', () => watcher.reset(null));
  onLocaleChange(refreshButton);
  window.addEventListener('localechange', refreshButton);

  let lastPoll = 0;
  const loop = time => {
    if (time - lastPoll >= POLL_MS) { lastPoll = time; try { watcher.poll(game?.world || null); } catch {} }
    window.requestAnimationFrame(loop);
  };
  window.requestAnimationFrame(loop);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountButton, { once: true }); else mountButton();

  const api = Object.freeze({ toggle, setMuted, setVolume, get muted() { return settings.muted; }, get volume() { return settings.volume; }, play: id => watcher.sfx(id), say: id => watcher.voice(id) });
  globalThis.gremiosAudio = api;
  return api;
}
