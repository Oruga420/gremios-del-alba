/**
 * Voice phrases. Results keep their Spanish `speak`/`message` (tests, logs and the voice agent read
 * it) and carry `i18n: { key, params }` so the panel can show them in the player's language.
 * A param may be { es, ref }: `es` is interpolated into the Spanish text, `ref` is the
 * language-neutral value (entity ref, nested key or cost) used for display.
 */
import { t, localize, localeInfo, registerParamFormatter, DEFAULT_LOCALE } from '../i18n/index.js';
import '../i18n/names.js';

const isDual = value => value && typeof value === 'object' && Object.hasOwn(value, 'es') && Object.hasOwn(value, 'ref');
function spanishParams(params) {
  if (!params) return params;
  return Object.fromEntries(Object.entries(params).map(([name, value]) => [name, isDual(value) ? String(value.es) : typeof value === 'number' ? String(value) : value]));
}
function displayParams(params) {
  if (!params) return undefined;
  return Object.fromEntries(Object.entries(params).map(([name, value]) => [name, isDual(value) ? value.ref : value]));
}
/** Builds { text, i18n }: text is the exact Spanish line. */
export function phrase(key, params) {
  const display = displayParams(params);
  return { text: t(key, spanishParams(params), DEFAULT_LOCALE), i18n: display ? { key, params: display } : { key } };
}
/** Status payload for adapters: { message (Spanish), i18n }. */
export function status(key, params) { const value = phrase(key, params); return { message: value.text, i18n: value.i18n }; }
/** Display text for a result/status in the active language; falls back to its Spanish field. */
export function display(record, field = 'speak') {
  if (record == null) return '';
  if (typeof record !== 'object') return String(record);
  return record.i18n ? localize(record, field) : String(record[field] ?? record.message ?? record.text ?? '');
}

const knownCost = kind => t(`voice.cost.${kind}`, null, DEFAULT_LOCALE) !== `voice.cost.${kind}`;
/** "50 madera, 20 oro" in Spanish. */
export function costSpanish(cost = {}) {
  const parts = Object.entries(cost).filter(([, amount]) => amount).map(([kind, amount]) => (knownCost(kind) ? t(`voice.cost.${kind}`, { amount: String(amount) }, DEFAULT_LOCALE) : `${amount} ${kind}`));
  return parts.join(t('voice.list.separator', null, DEFAULT_LOCALE)) || t('voice.cost.none', null, DEFAULT_LOCALE);
}
/** Dual param for a cost list. */
export const costParam = cost => ({ es: costSpanish(cost), ref: { voiceCost: { ...cost } } });
registerParamFormatter((value, code) => {
  if (!value || typeof value !== 'object' || !value.voiceCost) return null;
  const entries = Object.entries(value.voiceCost).filter(([, amount]) => amount);
  const parts = entries.map(([kind, amount]) => (knownCost(kind) ? t(`voice.cost.${kind}`, { amount: formatAmount(amount, code) }, code) : `${formatAmount(amount, code)} ${kind}`));
  return parts.join(t('voice.list.separator', null, code)) || t('voice.cost.none', null, code);
});
function formatAmount(amount, code) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return String(amount);
  try { return value.toLocaleString(localeInfo(code).number, { maximumFractionDigits: 4, useGrouping: false }); } catch { return String(value); }
}
/**
 * Dual param for a variable-length list of phrases (or plain strings) joined by a dictionary
 * separator key, or by a literal { text } separator (used for whole sentences).
 */
export function listParam(items, separator = 'voice.list.separator') {
  const join = typeof separator === 'string' ? t(separator, null, DEFAULT_LOCALE) : separator.text;
  const es = items.map(item => (typeof item === 'string' ? item : item.text)).join(join);
  return { es, ref: { voiceJoin: items.map(item => (typeof item === 'string' ? item : item.i18n)), separator } };
}
registerParamFormatter((value, code) => {
  if (!value || typeof value !== 'object' || !Array.isArray(value.voiceJoin)) return null;
  const separator = value.separator && typeof value.separator === 'object' ? value.separator.text : t(value.separator || 'voice.list.separator', null, code);
  return value.voiceJoin.map(item => (typeof item === 'string' ? item : t(item.key, item.params, code))).join(separator);
});
/** Entity display ref for "{name} [{id}]" labels. */
export const entityRef = entity => ({ kind: entity.kind, ...(entity.name ? { name: entity.name } : {}) });
