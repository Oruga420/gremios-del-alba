import { BUILDINGS, UNITS } from '../game/data.js';

const norm = value => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const nearestFirst = origin => (a, b) => distance(a, origin) - distance(b, origin) || String(a.id || '').localeCompare(String(b.id || ''));
export const center = entity => ({ x: entity.x + (BUILDINGS[entity.kind]?.size || 0) / 2, y: entity.y + (BUILDINGS[entity.kind]?.size || 0) / 2 });
export function referencePoint(game, units = []) {
  const selected = game.world.state.units.filter(u => u.team === 1 && u.hp > 0 && game.selectedIds.includes(u.id));
  const group = units.length ? units : selected;
  if (group.length) return { x: group.reduce((sum, u) => sum + u.x, 0) / group.length, y: group.reduce((sum, u) => sum + u.y, 0) / group.length };
  const hall = game.world.state.buildings.find(b => b.team === 1 && b.hp > 0 && b.kind === 'guildhall');
  const survivor = hall || game.world.state.units.find(u => u.team === 1 && u.hp > 0) || game.world.state.buildings.find(b => b.team === 1 && b.hp > 0);
  if (!survivor) fail('TARGET_NOT_FOUND', 'No quedan habitantes ni edificios propios para situar la orden.');
  return center(survivor);
}
export function explicitPoint(input, wall = false) {
  const keys = wall ? ['x', 'y', 'endX', 'endY'] : ['x', 'y'];
  const present = keys.filter(key => input[key] !== undefined);
  if (present.length && present.length !== keys.length) fail('POSITION_REQUIRED', wall ? 'Indica una dirección, por ejemplo al norte de tu base.' : 'Indica un lugar como tu base o el cuartel.');
  return present.length ? Object.fromEntries(keys.map(key => [key, input[key]])) : null;
}
export function reachable(world, units, point, every = true) {
  const test = unit => {
    const field = world.navigation.field(point.x, point.y, UNITS[unit.kind].movement);
    return field && field.distance[Math.floor(unit.y) * world.state.map.width + Math.floor(unit.x)] >= 0;
  };
  return units.length > 0 && (every ? units.every(test) : units.some(test));
}
export function resourceKind(query) {
  const text = norm(query);
  if (/\b(bosque|arbol|arboles|madera|wood|forest)\b/u.test(text)) return 'wood';
  if (/\b(comida|alimento|alimentos|food|huerto)\b/u.test(text)) return 'food';
  if (/\b(oro|gold)\b/u.test(text)) return 'gold';
  if (/\b(piedra|stone)\b/u.test(text)) return 'stone';
  if (/\b(pesca|pescado|peces|fish)\b/u.test(text)) return 'fish';
  return null;
}
export function nearestResource(game, kind, units) {
  return game.world.state.nodes.filter(n => n.amount > 0 && n.kind === kind && (!n.team || n.team === 1))
    .sort(nearestFirst(referencePoint(game, units))).find(node => reachable(game.world, units, node));
}
export function semanticPoint(game, input, units, resolve, defaultLocation) {
  const point = explicitPoint(input);
  if (point) return point;
  const location = input.destination || input.location || defaultLocation;
  if (!location) fail('DESTINATION_REQUIRED', 'Indica un lugar, por ejemplo tu base, el cuartel o el bosque cercano.');
  const kind = resourceKind(location);
  const entity = kind ? nearestResource(game, kind, units) : resolve(location, { origin: referencePoint(game, units) });
  if (!entity) fail('TARGET_NOT_FOUND', 'No hay un recurso accesible de ese tipo.');
  const destination = center(entity);
  if (units.length && !reachable(game.world, units, destination)) fail('UNREACHABLE_TARGET', 'No hay camino hasta ese destino para estas unidades.');
  return destination;
}

// Search only near the actual landmark; never silently place a requested local
// building on the opposite side of the map. The engine remains the spend owner.
export function constructionPoint(game, input, units, resolve, wall = false, automaticBuilder = false) {
  const explicit = explicitPoint(input, wall);
  if (explicit) return explicit;
  const text = norm(input.location || input.destination || 'mi base');
  const relation = text.match(/^(detras del?|atras del?|junto al?|al lado del?|cerca del?|delante del?|frente al?)\s+(.*)$/u);
  const directionMatch = text.match(/\b(norte|sur|este|oeste)(?:\s+del?\s+(.+))?$/u);
  const direction = directionMatch?.[1];
  const landmark = direction ? directionMatch[2] || 'mi base' : relation ? relation[2] : text;
  const anchor = resolve(landmark, { team: 1, buildingsOnly: true, origin: referencePoint(game, automaticBuilder ? units.slice(0, 1) : units) });
  const origin = center(anchor), size = BUILDINGS[input.kind].size;
  const enemy = game.world.state.buildings.find(b => b.team === 2 && b.hp > 0 && b.kind === 'guildhall');
  const front = enemy ? center(enemy) : { x: origin.x + 1, y: origin.y + 1 };
  let vector = direction ? { norte: [0, -1], sur: [0, 1], este: [1, 0], oeste: [-1, 0] }[direction] : null;
  if (relation && /detras|atras|delante|frente/u.test(relation[1])) {
    const sign = /detras|atras/u.test(relation[1]) ? -1 : 1, length = distance(front, origin) || 1;
    vector = [sign * (front.x - origin.x) / length, sign * (front.y - origin.y) / length];
  }
  if (wall && !vector) { const length = distance(front, origin) || 1; vector = [(front.x - origin.x) / length, (front.y - origin.y) / length]; }
  const radius = wall ? 18 : 14;
  const desired = wall ? { x: origin.x + vector[0] * 9, y: origin.y + vector[1] * 9 } : origin;
  const candidates = [];
  for (let y = Math.max(0, Math.floor(origin.y - radius)); y <= Math.min(game.world.state.map.height - size, origin.y + radius); y++) {
    for (let x = Math.max(0, Math.floor(origin.x - radius)); x <= Math.min(game.world.state.map.width - size, origin.x + radius); x++) {
      const p = { x, y }, middle = { x: x + size / 2, y: y + size / 2 };
      if (distance(middle, origin) > radius) continue;
      if (vector && (middle.x - origin.x) * vector[0] + (middle.y - origin.y) * vector[1] < (wall ? 6 : (BUILDINGS[anchor.kind].size + size) / 2)) continue;
      candidates.push({ ...p, score: distance(middle, desired) });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.y - b.y || a.x - b.x);
  for (const p of candidates) {
    const vertical = wall && Math.abs(vector[0]) >= Math.abs(vector[1]);
    const plots = wall ? Array.from({ length: input.length || 7 }, (_, i) => ({ x: p.x + (vertical ? 0 : i - Math.floor((input.length || 7) / 2)), y: p.y + (vertical ? i - Math.floor((input.length || 7) / 2) : 0) })) : [p];
    if (!plots.every(plot => game.world.canPlace(input.kind, plot.x, plot.y))) continue;
    // Match the engine's future-footprint preflight, including shore buildings.
    // Share each field across candidates and require one automatic builder to
    // reach every wall segment.
    const fields = plots.map(plot => game.world.navigation.field(plot.x, plot.y, UNITS.villager.movement, { kind: input.kind, x: plot.x, y: plot.y }));
    const canReach = (unit, field) => field && field.distance[Math.floor(unit.y) * game.world.state.map.width + Math.floor(unit.x)] >= 0;
    let builder;
    if (automaticBuilder) {
      builder = units.find(unit => fields.every(field => canReach(unit, field)));
      if (!builder) continue;
    } else if (!fields.every(field => units.some(unit => canReach(unit, field)))) continue;
    const point = wall ? { ...plots[0], endX: plots.at(-1).x, endY: plots.at(-1).y } : { x: p.x, y: p.y };
    return builder ? { ...point, builderId: builder.id } : point;
  }
  fail('NO_LEGAL_PLACEMENT', 'No hay espacio accesible cerca de ese lugar.');
}
