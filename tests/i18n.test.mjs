import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DICTIONARIES, LOCALE_CODES, DEFAULT_LOCALE, t, setLocale, resolveLocale, localize, interpolate } from '../src/i18n/index.js';
import { AREAS } from '../src/i18n/locales.js';
import { entityName, unitName, buildingName } from '../src/i18n/names.js';
import { UNITS, BUILDINGS, TECHNOLOGIES, GUILDS, MAPS } from '../src/game/data.js';

const source = DICTIONARIES[DEFAULT_LOCALE];
const placeholders = text => [...String(text).matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('seven languages are registered', () => {
  assert.deepEqual([...LOCALE_CODES].sort(), ['ar', 'de', 'en', 'es', 'fr', 'ja', 'pt']);
});
for (const code of LOCALE_CODES) {
  test(`${code}: every source key is translated with matching placeholders`, () => {
    const table = DICTIONARIES[code];
    const missing = Object.keys(source).filter(key => !Object.hasOwn(table, key));
    assert.deepEqual(missing, [], `${code} missing keys`);
    const extra = Object.keys(table).filter(key => !Object.hasOwn(source, key));
    assert.deepEqual(extra, [], `${code} has keys absent from Spanish`);
    for (const [key, value] of Object.entries(table)) {
      assert.equal(typeof value, 'string', `${code}:${key} is not a string`);
      assert.ok(value.trim().length > 0, `${code}:${key} is empty`);
      assert.deepEqual(placeholders(value), placeholders(source[key]), `${code}:${key} placeholders differ`);
    }
  });
}
test('each area file keeps its own key prefix', async () => {
  for (const code of LOCALE_CODES) for (const area of AREAS) {
    const { default: table } = await import(`../src/i18n/dict/${code}/${area}.js`);
    for (const key of Object.keys(table)) assert.ok(key.startsWith(`${area}.`), `${code}/${area}.js contains foreign key ${key}`);
  }
});
test('game data has a name in every language', () => {
  const keys = [
    ...Object.keys(UNITS).map(id => `data.unit.${id}`), ...Object.keys(BUILDINGS).map(id => `data.building.${id}`),
    ...Object.keys(TECHNOLOGIES).map(id => `data.tech.${id}`), ...GUILDS.flatMap(g => ['name', 'description', 'label', 'specialty'].map(f => `data.guild.${g.id}.${f}`)),
    ...MAPS.flatMap(m => [`data.map.${m.id}.name`, `data.map.${m.id}.description`]),
  ];
  for (const key of keys) assert.ok(Object.hasOwn(source, key), `missing ${key}`);
});
test('translation, fallback, interpolation and entity names', () => {
  assert.equal(resolveLocale(['pt-BR', 'en']), 'pt');
  assert.equal(resolveLocale(['xx']), 'es');
  setLocale('en', { persist: false });
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.equal(interpolate('{a} / {b}', { a: 1200, b: 'x' }), '1,200 / x');
  assert.equal(entityName({ kind: 'villager', name: 'Luna' }), 'Luna');
  assert.equal(entityName({ kind: 'barracks', name: BUILDINGS.barracks.name }), buildingName('barracks'));
  assert.equal(localize({ message: 'hola' }), 'hola');
  setLocale('ja', { persist: false });
  assert.equal(entityName({ kind: 'archer', name: UNITS.archer.name }), unitName('archer'));
  setLocale('es', { persist: false });
  assert.equal(unitName('villager'), 'Aldeano');
});
test('index.html declares a language selector', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-language-select/);
});
