/**
 * Interface translation. Keys are flat dotted strings ("app.pause"), values may contain
 * {placeholders}. Missing keys fall back to Spanish (the source language) and then to the key.
 * Persisted per browser; never stored in saves, so a chronicle opens in any language.
 */
import { LOCALES, DEFAULT_LOCALE, LOCALE_CODES } from './locales.js';
import es from './dict/es/index.js';
import en from './dict/en/index.js';
import pt from './dict/pt/index.js';
import ja from './dict/ja/index.js';
import ar from './dict/ar/index.js';
import de from './dict/de/index.js';
import fr from './dict/fr/index.js';

export { LOCALES, DEFAULT_LOCALE, LOCALE_CODES };
export const DICTIONARIES = Object.freeze({ es, en, pt, ja, ar, de, fr });
const STORAGE_KEY = 'gremios-locale';
let current = DEFAULT_LOCALE;
const listeners = new Set();

export function resolveLocale(candidates = []) {
  for (const candidate of candidates) {
    const code = String(candidate || '').toLowerCase().split(/[-_]/)[0];
    if (LOCALE_CODES.includes(code)) return code;
  }
  return DEFAULT_LOCALE;
}
function initialLocale() {
  let stored = null;
  try { stored = globalThis.localStorage?.getItem(STORAGE_KEY); } catch { stored = null; }
  if (stored && LOCALE_CODES.includes(stored)) return stored;
  const nav = globalThis.navigator;
  return resolveLocale(nav ? [...(nav.languages || []), nav.language] : []);
}
current = initialLocale();

export const getLocale = () => current;
export const localeInfo = (code = current) => LOCALES.find(locale => locale.code === code) || LOCALES[0];
export const isRTL = (code = current) => localeInfo(code).dir === 'rtl';

export function setLocale(code, { persist = true } = {}) {
  if (!LOCALE_CODES.includes(code)) return false;
  const changed = code !== current;
  current = code;
  if (persist) { try { globalThis.localStorage?.setItem(STORAGE_KEY, code); } catch {} }
  applyDocumentLocale();
  if (changed) {
    for (const listener of listeners) { try { listener(code); } catch (error) { console.error(error); } }
    try { globalThis.dispatchEvent?.(new CustomEvent('localechange', { detail: { locale: code } })); } catch {}
  }
  return true;
}
export function onLocaleChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }

export function hasKey(key, code = current) { return Object.hasOwn(DICTIONARIES[code] || {}, key); }
export function t(key, params, code = current) {
  const table = DICTIONARIES[code] || {};
  let text = Object.hasOwn(table, key) ? table[key] : Object.hasOwn(DICTIONARIES[DEFAULT_LOCALE], key) ? DICTIONARIES[DEFAULT_LOCALE][key] : key;
  if (params && typeof text === 'string') text = interpolate(text, params, code);
  return text;
}
/** Replaces {name} placeholders. Object params of the shape {kind, name} are entity references. */
export function interpolate(text, params, code = current) {
  return String(text).replace(/\{(\w+)\}/g, (match, name) => {
    if (!Object.hasOwn(params, name)) return match;
    const value = params[name];
    if (value && typeof value === 'object') return formatParam(value, code);
    if (typeof value === 'number') return formatNumber(value, code);
    return String(value ?? '');
  });
}
const paramFormatters = [];
/** names.js registers the entity formatter so this module stays free of game data imports. */
export function registerParamFormatter(formatter) { paramFormatters.push(formatter); }
function formatParam(value, code) {
  for (const formatter of paramFormatters) { const text = formatter(value, code); if (text != null) return text; }
  if (value.key) return t(value.key, value.params, code);
  return String(value.name ?? value.kind ?? '');
}
/** Translates a world/voice result or event that may carry {i18n:{key,params}}; falls back to its Spanish text. */
export function localize(record, fallbackField = 'message') {
  if (!record) return '';
  if (record.i18n?.key && (hasKey(record.i18n.key) || hasKey(record.i18n.key, DEFAULT_LOCALE))) return t(record.i18n.key, record.i18n.params);
  return String(record[fallbackField] ?? record.text ?? '');
}
export function formatNumber(value, code = current) {
  const n = Math.floor(Number(value) || 0);
  try { return n.toLocaleString(localeInfo(code).number); } catch { return String(n); }
}

/** DOM binding: data-i18n (textContent), data-i18n-html (trusted markup from dictionaries), data-i18n-title, data-i18n-aria-label, data-i18n-placeholder. */
export function translateDOM(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  for (const element of root.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const element of root.querySelectorAll('[data-i18n-html]')) element.innerHTML = t(element.dataset.i18nHtml);
  for (const element of root.querySelectorAll('[data-i18n-title]')) element.title = t(element.dataset.i18nTitle);
  for (const element of root.querySelectorAll('[data-i18n-aria-label]')) element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  for (const element of root.querySelectorAll('[data-i18n-placeholder]')) element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
}
export function applyDocumentLocale() {
  const document = globalThis.document;
  if (!document?.documentElement) return;
  document.documentElement.lang = current;
  document.documentElement.dir = localeInfo().dir;
  if (Object.hasOwn(DICTIONARIES[current], 'html.title') || Object.hasOwn(DICTIONARIES[DEFAULT_LOCALE], 'html.title')) document.title = t('html.title');
  translateDOM(document);
  for (const select of document.querySelectorAll('select[data-language-select]')) select.value = current;
}
/** Fills every <select data-language-select> with the supported languages and wires changes. */
export function mountLanguageSelects(root = globalThis.document) {
  if (!root?.querySelectorAll) return;
  for (const select of root.querySelectorAll('select[data-language-select]')) {
    if (!select.options.length) for (const locale of LOCALES) {
      const option = root.createElement ? root.createElement('option') : globalThis.document.createElement('option');
      option.value = locale.code; option.textContent = locale.label; option.lang = locale.code; option.dir = locale.dir;
      select.append(option);
    }
    select.value = current;
    if (!select.dataset.languageBound) { select.dataset.languageBound = '1'; select.addEventListener('change', () => setLocale(select.value)); }
  }
}
