/** Localized names for game data. The Spanish names in data.js stay as stable save/voice identifiers. */
import { UNITS, BUILDINGS, TECHNOLOGIES, GUILDS, MAPS } from '../game/data.js';
import { t, hasKey, registerParamFormatter, DEFAULT_LOCALE } from './index.js';

const known = (key, fallback) => (hasKey(key) || hasKey(key, DEFAULT_LOCALE) ? t(key) : fallback);
export const unitName = kind => known(`data.unit.${kind}`, UNITS[kind]?.name ?? kind);
export const buildingName = kind => known(`data.building.${kind}`, BUILDINGS[kind]?.name ?? kind);
export const techName = id => known(`data.tech.${id}`, TECHNOLOGIES[id]?.name ?? id);
export const ageName = age => known(`data.age.${age}`, '');
export const resourceName = kind => known(`data.resource.${kind}`, kind);
export const resourceShort = kind => known(`data.resourceShort.${kind}`, kind);
export const teamName = team => known(`data.team.${team}`, '');
export const guildText = (id, field) => known(`data.guild.${id}.${field}`, GUILDS.find(guild => guild.id === id)?.[field] ?? id);
export const mapText = (id, field) => known(`data.map.${id}.${field}`, MAPS.find(map => map.id === id)?.[field] ?? id);
/** Any kind id: unit, building, technology or resource. */
export const kindName = kind => UNITS[kind] ? unitName(kind) : BUILDINGS[kind] ? buildingName(kind) : TECHNOLOGIES[kind] ? techName(kind) : resourceName(kind);
/**
 * Display name for a live entity. Villagers keep their personal names; entities whose name is
 * their kind's Spanish default (e.g. "Cuartel") are shown in the active language.
 */
export function entityName(entity) {
  if (!entity) return '';
  const definition = UNITS[entity.kind] || BUILDINGS[entity.kind];
  if (!entity.name || (definition && entity.name === definition.name)) return kindName(entity.kind);
  if (entity.name === 'Tu ciudad') return teamName(1);
  if (entity.name === 'Gremio rival') return teamName(2);
  return entity.name;
}
// Entity references inside {placeholders}: {kind:'farm'} or {kind:'villager', name:'Luna'}.
registerParamFormatter(value => (value && typeof value === 'object' && 'kind' in value ? entityName(value) : null));
