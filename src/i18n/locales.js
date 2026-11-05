/** Supported interface languages. `speech` is the BCP-47 tag used for recognition and voice lines. */
export const LOCALES = Object.freeze([
  { code: 'es', label: 'Español', dir: 'ltr', speech: 'es-ES', number: 'es-ES' },
  { code: 'en', label: 'English', dir: 'ltr', speech: 'en-US', number: 'en-US' },
  { code: 'pt', label: 'Português', dir: 'ltr', speech: 'pt-BR', number: 'pt-BR' },
  { code: 'ja', label: '日本語', dir: 'ltr', speech: 'ja-JP', number: 'ja-JP' },
  { code: 'ar', label: 'العربية', dir: 'rtl', speech: 'ar-SA', number: 'ar' },
  { code: 'de', label: 'Deutsch', dir: 'ltr', speech: 'de-DE', number: 'de-DE' },
  { code: 'fr', label: 'Français', dir: 'ltr', speech: 'fr-FR', number: 'fr-FR' },
]);
export const DEFAULT_LOCALE = 'es';
export const LOCALE_CODES = Object.freeze(LOCALES.map(locale => locale.code));
/** Dictionary areas. Every language has one file per area under src/i18n/dict/<code>/<area>.js. */
export const AREAS = Object.freeze(['data', 'html', 'app', 'world', 'render', 'voice', 'audio']);
