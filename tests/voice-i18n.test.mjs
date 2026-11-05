import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { setLocale, t } from '../src/i18n/index.js';
import voiceEs from '../src/i18n/dict/es/voice.js';
import { translateCommand, normalizeCommand } from '../src/voice/lexicon.js';
import { parseSpanishCommand } from '../src/voice/spanish.js';
import { createVoiceRegistry } from '../src/voice/registry.js';
import { display } from '../src/voice/i18n.js';
import { prepared } from './world-scenarios.mjs';

const parse = text => { const parsed = parseSpanishCommand(text); return parsed.error ? { error: parsed.error.code } : parsed; };

test('Spanish orders pass through the lexicon untouched', () => {
  for (const phrase of ['Selecciona a Luna', 'Luna recoge madera', 'Cambia el nombre de Bruno a Teo', 'Constructores, levanten una muralla al norte', 'Entrena cinco arqueros',
    'Caballeros pesados, defiendan la puerta', 'Magos, ataquen la torre roja', 'Confirma', 'Alto', 'Forma en línea', 'Formación escalonada', 'Forma los arqueros en caja',
    'Mueve los arqueros en caja a mi base', 'Arqueros, vayan a mi base en línea', 'Caja ve a mi base', 'Punto de reunión del centro urbano al bosque', 'Pon el punto de reunión al oro',
    'Compra diez madera', 'Avanza de era', 'Pausa', 'Continúa la partida', 'Guarda la partida', 'carga la partida', 'Construye una casa detrás del cuartel', 'Magos lancen bola de fuego a la base enemiga',
    'Estado', 'Ayuda', 'Para', 'Ataca la base enemiga', 'Recoge oro', 'Entrena un aldeano', 'Sanadores, curen a los heridos', 'Repara la puerta', 'Luna va al bosque']) {
    assert.equal(normalizeCommand(phrase), phrase, phrase);
    assert.equal(translateCommand(phrase).lang, null, phrase);
  }
});

const CASES = {
  en: [
    ['build a house', { name: 'propose_build', input: { kind: 'house' } }],
    ['Build a house behind the barracks', { name: 'propose_build', input: { kind: 'house', location: 'detras del cuartel' } }],
    ['gather wood', { name: 'propose_gather', input: { resource: 'wood' } }],
    ['Luna, gather gold', { name: 'propose_gather', input: { resource: 'gold', target: 'luna' } }],
    ['move the archers in a line to my base', { name: 'propose_move', input: { destination: 'mi base', formation: 'line', target: 'arqueros' } }],
    ['archers attack the enemy base', { name: 'propose_attack', input: { enemy: 'base enemiga', target: 'arqueros' } }],
    ['Stop', { name: 'stop_action', input: {} }],
    ['form a box', { name: 'propose_formation', input: { kind: 'box' } }],
    ['staggered formation', { name: 'propose_formation', input: { kind: 'staggered' } }],
    ['train a villager', { name: 'propose_train', input: { quantity: 1, kind: 'villager' } }],
    ['set the rally point of the town center to the forest', { name: 'propose_rally', input: { building: 'centro urbano', destination: 'bosque' } }],
    ['pause', { name: 'propose_pause', input: { paused: true } }],
    ['resume the game', { name: 'propose_pause', input: { paused: false } }],
    ['save the game', { name: 'propose_save', input: {} }],
  ],
  pt: [
    ['construa uma casa', { name: 'propose_build', input: { kind: 'house' } }],
    ['colete pedra', { name: 'propose_gather', input: { resource: 'stone' } }],
    ['mova os arqueiros para a base', { name: 'propose_move', input: { destination: 'mi base', target: 'arqueros' } }],
    ['ataque a base inimiga', { name: 'propose_attack', input: { enemy: 'base enemiga' } }],
    ['pare', { name: 'stop_action', input: {} }],
    ['treine cinco aldeões', { name: 'propose_train', input: { quantity: 5, kind: 'villager' } }],
    ['formação em linha', { name: 'propose_formation', input: { kind: 'line' } }],
    ['ponto de encontro para a floresta', { name: 'propose_rally', input: { destination: 'bosque' } }],
    ['salve o jogo', { name: 'propose_save', input: {} }],
  ],
  ja: [
    ['家を建てて', { name: 'propose_build', input: { kind: 'house' } }],
    ['兵舎の近くに家を建てて', { name: 'propose_build', input: { kind: 'house', location: 'cerca del cuartel' } }],
    ['木を集めて', { name: 'propose_gather', input: { resource: 'wood' } }],
    ['弓兵を基地に移動して', { name: 'propose_move', input: { destination: 'mi base', target: 'arqueros' } }],
    ['敵の基地を攻撃して', { name: 'propose_attack', input: { enemy: 'base enemiga' } }],
    ['止まれ', { name: 'stop_action', input: {} }],
    ['村人を5人訓練して', { name: 'propose_train', input: { quantity: 5, kind: 'villager' } }],
    ['横一列に並べて', { name: 'propose_formation', input: { kind: 'line' } }],
    ['集合地点を森に設定して', { name: 'propose_rally', input: { destination: 'bosque' } }],
    ['一時停止', { name: 'propose_pause', input: { paused: true } }],
    ['保存', { name: 'propose_save', input: {} }],
  ],
  ar: [
    ['ابن منزلا', { name: 'propose_build', input: { kind: 'house' } }],
    ['اجمع الخشب', { name: 'propose_gather', input: { resource: 'wood' } }],
    ['حرك الرماة إلى القاعدة', { name: 'propose_move', input: { destination: 'mi base', target: 'arqueros' } }],
    ['هاجم قاعدة العدو', { name: 'propose_attack', input: { enemy: 'base enemiga' } }],
    ['توقف', { name: 'stop_action', input: {} }],
    ['درب خمسة قرويين', { name: 'propose_train', input: { quantity: 5, kind: 'villager' } }],
    ['تشكيل مربع', { name: 'propose_formation', input: { kind: 'box' } }],
    ['احفظ اللعبة', { name: 'propose_save', input: {} }],
  ],
  de: [
    ['baue ein Haus', { name: 'propose_build', input: { kind: 'house' } }],
    ['ein Haus bauen', { name: 'propose_build', input: { kind: 'house' } }],
    ['Sammle Holz', { name: 'propose_gather', input: { resource: 'wood' } }],
    ['Bewege die Bogenschützen zur Basis', { name: 'propose_move', input: { destination: 'mi base', target: 'arqueros' } }],
    ['Greift die feindliche Basis an', { name: 'propose_attack', input: { enemy: 'base enemiga' } }],
    ['Halt', { name: 'stop_action', input: {} }],
    ['Trainiere 3 Dorfbewohner', { name: 'propose_train', input: { quantity: 3, kind: 'villager' } }],
    ['Bildet eine Linie', { name: 'propose_formation', input: { kind: 'line' } }],
    ['Spiel speichern', { name: 'propose_save', input: {} }],
  ],
  fr: [
    ['construis une maison', { name: 'propose_build', input: { kind: 'house' } }],
    ['construis une ferme à côté de la caserne', { name: 'propose_build', input: { kind: 'farm', location: 'junto al cuartel' } }],
    ['récolte du bois', { name: 'propose_gather', input: { resource: 'wood' } }],
    ['déplace les archers vers la base', { name: 'propose_move', input: { destination: 'mi base', target: 'arqueros' } }],
    ['attaque la base ennemie', { name: 'propose_attack', input: { enemy: 'base enemiga' } }],
    ['arrête', { name: 'stop_action', input: {} }],
    ['entraîne deux villageois', { name: 'propose_train', input: { quantity: 2, kind: 'villager' } }],
    ['formation en quinconce', { name: 'propose_formation', input: { kind: 'staggered' } }],
    ['mets en pause', { name: 'propose_pause', input: { paused: true } }],
    ['sauvegarde la partie', { name: 'propose_save', input: {} }],
  ],
};
for (const [lang, cases] of Object.entries(CASES)) {
  test(`${lang}: common orders become the equivalent Spanish tool call`, () => {
    for (const [phrase, expected] of cases) {
      assert.equal(translateCommand(phrase, { locale: lang }).lang, lang, phrase);
      assert.deepEqual(parse(phrase), expected, `${phrase} → ${normalizeCommand(phrase, { locale: lang })}`);
    }
  });
}

test('negated foreign orders are never rewritten into the positive Spanish order', () => {
  for (const [phrase, locale] of [["don't attack", 'en'], ['do not build a house', 'en'], ['never attack the enemy base', 'en'], ['não ataque', 'pt'], ["n'attaque pas", 'fr'], ['ne construis pas de maison', 'fr'],
    ['nicht angreifen', 'de'], ['kein Haus bauen', 'de'], ['攻撃しないで', 'ja'], ['家を建てないで', 'ja'], ['لا تهاجم', 'ar']]) {
    assert.equal(translateCommand(phrase, { locale }).lang, null, phrase);
    // The Spanish parser already knows a few English verbs ("attack", "build"); there the negation
    // stays in the target and fails resolution, so only the other languages are checked here.
    if (locale !== 'en') assert.equal(parse(phrase).error, 'COMMAND_NOT_UNDERSTOOD', phrase);
  }
});

test('foreign words that are also Spanish interjections only translate in their own locale', () => {
  assert.equal(translateCommand('ja', { locale: 'es' }).lang, null);
  assert.equal(translateCommand('ja', { locale: 'de' }).text, 'confirma');
});

test('every voice.* key referenced by src/voice exists in the Spanish dictionary', () => {
  const dir = new URL('../src/voice/', import.meta.url);
  const missing = [];
  for (const file of readdirSync(dir).filter(name => name.endsWith('.js'))) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    for (const [, key] of source.matchAll(/['`](voice\.[\w.-]+[\w])['`]/gu)) if (!Object.hasOwn(voiceEs, key) && !Object.hasOwn(voiceEs, `${key}.one`)) missing.push(`${file}: ${key}`);
  }
  assert.deepEqual(missing, []);
});

test('tool results keep their Spanish speak and display the same text through i18n in Spanish', () => {
  setLocale('es', { persist: false });
  const game = { world: prepared({ mode: 'conquest' }), worldGeneration: 1, selectedIds: [], execute(type, args) { return this.world.command(type, args); }, select(ids) { this.selectedIds = ids; }, view() { return { ok: true }; }, openPanel() {} };
  const registry = createVoiceRegistry(game);
  const run = text => { const parsed = parseSpanishCommand(text, { game, confirm: registry.confirm, mode: registry.mode }); return parsed.error || registry.runTool(parsed.name, parsed.input); };
  const results = [run('Estado'), run('oficios'), run('busca a Luna'), run('examina a Luna'), run('Selecciona a Luna'), run('Luna recoge madera'), run('frase sin sentido'), run('Entrena 900 arqueros'),
    registry.runTool('read_catalog', { category: 'units' }), registry.runTool('control_group', { action: 'assign', group: 2 }), registry.runTool('nope'), registry.runTool('propose_move', { destination: 'ningun lugar conocido' })];
  for (const value of results) {
    assert.ok(value.i18n?.key, `missing i18n on ${JSON.stringify(value).slice(0, 160)}`);
    assert.equal(display(value), value.speak, value.i18n.key);
  }
  assert.equal(results[0].speak, t(results[0].i18n.key, results[0].i18n.params, 'es'));
});

test('confirmed proposals carry translatable lines aligned with their Spanish lines', () => {
  setLocale('es', { persist: false });
  let now = 0;
  const game = { world: prepared({ mode: 'conquest' }), worldGeneration: 1, selectedIds: [], execute(type, args) { return this.world.command(type, args); }, select(ids) { this.selectedIds = ids; } };
  const registry = createVoiceRegistry(game, { confirmationMode: 'confirmed', confirmOptions: { now: () => now } });
  const proposed = registry.runTool('propose_build', { kind: 'house' });
  assert.equal(proposed.code, 'PROPOSED', proposed.speak);
  assert.equal(display(proposed), proposed.speak);
  const { action } = registry.confirm.getState();
  assert.equal(action.lines.length, action.lineI18n.length);
  action.lines.forEach((line, index) => { if (!/^.+ \[n\d+\]/u.test(line)) assert.equal(display({ speak: line, i18n: action.lineI18n[index] }), line); });
  registry.confirm.stop();
});
