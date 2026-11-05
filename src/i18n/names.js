/** Localized names for game data. The Spanish names in data.js stay as stable save/voice identifiers. */
import { UNITS, BUILDINGS, TECHNOLOGIES, GUILDS, MAPS } from '../game/data.js';
import { t, hasKey, registerParamFormatter, DEFAULT_LOCALE } from './index.js';

// `code` is optional: callers that render a specific language (e.g. Spanish logs) pass it; otherwise the active one is used.
const known = (key, fallback, code) => (hasKey(key, code) || hasKey(key, DEFAULT_LOCALE) ? t(key, null, code) : fallback);
export const unitName = (kind, code) => known(`data.unit.${kind}`, UNITS[kind]?.name ?? kind, code);
export const buildingName = (kind, code) => known(`data.building.${kind}`, BUILDINGS[kind]?.name ?? kind, code);
export const techName = (id, code) => known(`data.tech.${id}`, TECHNOLOGIES[id]?.name ?? id, code);
export const ageName = age => known(`data.age.${age}`, '');
export const resourceName = (kind, code) => known(`data.resource.${kind}`, kind, code);
export const resourceShort = kind => known(`data.resourceShort.${kind}`, kind);
export const teamName = (team, code) => known(`data.team.${team}`, '', code);
export const guildText = (id, field) => known(`data.guild.${id}.${field}`, GUILDS.find(guild => guild.id === id)?.[field] ?? id);
export const mapText = (id, field) => known(`data.map.${id}.${field}`, MAPS.find(map => map.id === id)?.[field] ?? id);
/** Any kind id: unit, building, technology or resource. */
export const kindName = (kind, code) => UNITS[kind] ? unitName(kind, code) : BUILDINGS[kind] ? buildingName(kind, code) : TECHNOLOGIES[kind] ? techName(kind, code) : resourceName(kind, code);
/**
 * Display name for a live entity. Villagers keep their personal names; entities whose name is
 * their kind's Spanish default (e.g. "Cuartel") are shown in the active language.
 */
export function entityName(entity, code) {
  if (!entity) return '';
  const definition = UNITS[entity.kind] || BUILDINGS[entity.kind];
  if (!entity.name || (definition && entity.name === definition.name)) return kindName(entity.kind, code);
  if (entity.name === 'Tu ciudad') return teamName(1, code);
  if (entity.name === 'Gremio rival') return teamName(2, code);
  return entity.name;
}
// Entity references inside {placeholders}: {kind:'farm'} or {kind:'villager', name:'Luna'}.
registerParamFormatter((value, code) => (value && typeof value === 'object' && 'kind' in value ? entityName(value, code) : null));
