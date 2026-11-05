import { World } from '../game/world.js';
import { BUILDINGS, UNITS, TECHNOLOGIES, MAPS, GUILDS, AGE_COSTS } from '../game/data.js';
import { TOOL_SPECS } from './specs.js';
import { validateSchema } from './schema.js';
import { createConfirmStore } from './confirm.js';
import { nearestFirst, referencePoint, explicitPoint, resourceKind, nearestResource, semanticPoint, constructionPoint } from './semantic.js';
import { phrase, costParam, listParam, entityRef } from './i18n.js';

export const normalize = (value) => String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es').replace(/[¿?¡!.,;:]/gu, ' ').replace(/\s+/gu, ' ').trim();
const bare = (value) => normalize(value).replace(/^(?:(?:a|al|el|la|los|las|mi|mis|todos|todas|de|del)\s+)+/u, '');
export const ROLE_ALIASES = {
  villager: ['aldeano','aldeanos','aldeana','aldeanas','constructor','constructores','trabajador','trabajadores','villager','villagers','worker','workers'],
  infantry: ['lancero','lanceros','guardia','guardias','infanteria','infantry'], scout: ['explorador','exploradores','scout','scouts'],
  archer: ['arquero','arqueros','arquera','arqueras','archer','archers'], cavalry: ['jinete','jinetes','caballeria','cavalry'],
  heavy_knight: ['caballero pesado','caballeros pesados','caballera pesada','caballeras pesadas','heavy knight','heavy knights'],
  assassin: ['asesino','asesinos','asesina','asesinas','assassin','assassins'], mage: ['mago','magos','maga','magas','mage','mages'],
  healer: ['sanador','sanadores','sanadora','sanadoras','curandero','curanderos','curandera','curanderas','healer','healers'],
  wizard: ['hechicero','hechiceros','hechicera','hechiceras','wizard','wizards'], siege_engine: ['catapulta','catapultas','asedio','siege engine','siege engines'],
  fishing_boat: ['barca pesquera','barcas pesqueras','pescador','pescadores','fishing boat','fishing boats'], war_boat: ['navio','navios','barco de guerra','barcos de guerra','war boat','war boats']
};
const BUILDING_ALIASES = { house:['casa','casas','casa de aldea'],guildhall:['casa del gremio','ayuntamiento','centro urbano'],farm:['huerto','granja','farm'],lumber_camp:['campamento maderero','aserradero'],mill:['molino'],mining_camp:['campamento minero','mina'],barracks:['cuartel'],archery:['arqueria'],stable:['establo'],arcane_tower:['torre arcana'],sanctuary:['santuario'],forge:['forja'],market:['mercado'],academy:['academia'],watchtower:['atalaya','torre de vigilancia'],fortress:['fortaleza'],palisade:['empalizada'],wall:['muralla','muralla de piedra'],gate:['puerta','puerta del gremio'],dock:['puerto','muelle'],wonder:['arbol de las eras','maravilla'],siege_workshop:['taller de asedio'],granary:['granero'],university:['universidad'] };
// `speak` stays the exact Spanish line; `i18n` lets the interface show it in the player's language.
const said = (key, params) => phrase(key, params);
const result = (ok, code, speak, data) => ({ ok, code, speak: typeof speak === 'string' ? speak : speak.text, ...(speak?.i18n ? { i18n: speak.i18n } : {}), ...(data === undefined ? {} : { data }) });
const fail = (code, speak, data) => { const error = new Error(typeof speak === 'string' ? speak : speak.text); error.code = code; error.data = data; if (speak?.i18n) error.i18n = speak.i18n; throw error; };
const failure = (error) => ({ text: error.message, ...(error.i18n ? { i18n: error.i18n } : {}) });
const validEntity = (entity) => entity && (Object.hasOwn(entity, 'amount') ? entity.amount > 0 : entity.hp > 0);
const label = (entity) => `${entity.name || UNITS[entity.kind]?.name || BUILDINGS[entity.kind]?.name || entity.kind} [${entity.id}]`;
const labelParam = (entity) => ({ es: label(entity), ref: { key: 'voice.label', params: { name: entityRef(entity), id: String(entity.id) } } });
const kindParam = (kind) => ({ es: UNITS[kind]?.name || BUILDINGS[kind]?.name || TECHNOLOGIES[kind]?.name || kind, ref: { kind } });
const multiply = (cost, count) => Object.fromEntries(Object.entries(cost || {}).map(([key, value]) => [key, value * count]));
export function catalogId(query, catalog, aliases = {}) {
  const norm = bare(query);
  return Object.entries(catalog).find(([id, definition]) => [normalize(id.replaceAll('_', ' ')), normalize(definition.name), ...(aliases[id] || [])].includes(norm))?.[0] || null;
}
export const unitKind = (query) => catalogId(query, UNITS, ROLE_ALIASES);
export const buildingKind = (query) => catalogId(query, BUILDINGS, BUILDING_ALIASES);

export function resolveEntity(game, query, { team = null, buildingsOnly = false, origin }  = {}) {
  if (!game.world) fail('NO_MATCH', said('voice.registry.noMatch'));
  origin ||= referencePoint(game);
  const text = normalize(query), enemy = /\b(enemig[oa]s?|rival|roja|rojo)\b/u.test(text), own = /\b(mi|mis|nuestra|nuestro|propia|propio)\b/u.test(text);
  if (team !== null && ((enemy && team !== 2) || (own && team !== 1))) fail('TARGET_NOT_FOUND', said('voice.registry.teamNotAllowed'));
  const targetTeam = team ?? (enemy ? 2 : own ? 1 : null);
  let entities = [...game.world.state.units, ...game.world.state.buildings, ...game.world.state.nodes].filter(entity => validEntity(entity) && (targetTeam === null || entity.team === targetTeam) && (!buildingsOnly || BUILDINGS[entity.kind]));
  const exactId = entities.find(entity => String(entity.id) === String(query).trim().replace(/^#/u, ''));
  if (exactId) return exactId;
  const nameQueries = [text, text.replace(/^(?:a|al)\s+/u, '')];
  const names = entities.filter(entity => UNITS[entity.kind] && nameQueries.includes(normalize(entity.name)));
  if (names.length > 1) fail('AMBIGUOUS_TARGET', said('voice.registry.ambiguousTarget'), names.slice(0, 8).map(entity => ({ name: entity.name, kind: entity.kind, x: entity.x, y: entity.y })));
  if (names.length) return names[0];
  const semantic = bare(text).replace(/\b(?:mas cercano|mas cercana|cercanos|cercanas|cercano|cercana|enemigos|enemigas|enemiga|enemigo|rival|roja|rojo|propia|propio|nuestra|nuestro)\b/gu, '').replace(/\s+/gu, ' ').replace(/\s+del?$/u, '').trim();
  let candidates;
  if (['base','ciudad','casa','hogar','home'].includes(semantic)) candidates = entities.filter(e => e.kind === 'guildhall' && e.team === (targetTeam ?? 1));
  else if (/\bheridos?\b/u.test(semantic)) candidates = entities.filter(e => e.team === 1 && UNITS[e.kind] && e.hp < e.maxHp);
  else if (!semantic && enemy) candidates = entities.filter(e => e.team === 2);
  else {
    const kind = buildingKind(semantic) || unitKind(semantic), resource = resourceKind(semantic);
    candidates = entities.filter(e => kind ? e.kind === kind : resource ? e.kind === resource : semantic === 'torre' && ['watchtower', 'arcane_tower'].includes(e.kind));
    if (targetTeam === null && !resource) candidates = candidates.filter(e => e.team === 1);
  }
  candidates.sort(nearestFirst(origin));
  if (!candidates.length) fail('TARGET_NOT_FOUND', said('voice.registry.targetNotFound', { query: String(query).slice(0, 80) }));
  return candidates[0];
}

export function resolveUnits(game, query, { workers = false, idle = false, fallback = null, allWorkers = false } = {}) {
  if (!game.world) fail('NO_MATCH', said('voice.registry.noMatch'));
  const own = game.world.state.units.filter((entity) => entity.team === 1 && entity.hp > 0);
  let units;
  if (!query) {
    const compatible = entity => workers ? entity.kind === 'villager' : fallback === 'military' ? UNITS[entity.kind].attack > 0 && UNITS[entity.kind].role !== 'worker' && entity.kind !== 'healer' : fallback === 'heal' || fallback === 'fireball' ? UNITS[entity.kind].spell === fallback : fallback === 'gather' ? entity.kind === 'villager' : fallback === 'fish' ? entity.kind === 'fishing_boat' : fallback === 'convert' ? entity.kind === 'wizard' : true;
    units = own.filter(entity => game.selectedIds.includes(entity.id) && compatible(entity));
    if (!units.length && (workers || fallback)) {
      units = own.filter(entity => compatible(entity) && (fallback !== 'move' || (UNITS[entity.kind].attack > 0 && UNITS[entity.kind].role !== 'worker' && entity.kind !== 'healer'))).sort((a, b) => Number(!['idle','stop'].includes(a.order?.type)) - Number(!['idle','stop'].includes(b.order?.type)) || String(a.id).localeCompare(String(b.id)));
      if (workers && !allWorkers) units = units.slice(0, 1);
    }
  }
  else {
    const norm = bare(query).replace(/^(?:los|las|mis|todos los|todas las)\s+/u, '');
    const nameQueries = [normalize(query), normalize(query).replace(/^(?:a|al)\s+/u, '')];
    const exact = own.filter((entity) => nameQueries.includes(normalize(entity.name)) || String(entity.id) === String(query).trim().replace(/^#/u, ''));
    if (exact.length > 1) fail('AMBIGUOUS_NAME', said('voice.registry.ambiguousName'), exact.slice(0, 8).map((entity) => ({ id: entity.id, name: entity.name })));
    if (exact.length) units = exact;
    else if (/\s+y\s+/u.test(query)) units = [...new Set(String(query).split(/\s+y\s+/u).flatMap((name) => resolveUnits(game, name)))];
    else if (['habitantes','unidades','gremio','todos','todas'].includes(norm) || normalize(query) === 'todos') units = own;
    else if (['militares','ejercito','soldados','tropas'].includes(norm)) units = own.filter((entity) => UNITS[entity.kind].role !== 'worker' && UNITS[entity.kind].attack > 0 && entity.kind !== 'healer');
    else { const kind = unitKind(norm); units = kind ? own.filter((entity) => entity.kind === kind) : []; }
  }
  if (workers && units.some((entity) => entity.kind !== 'villager')) fail('WORKERS_REQUIRED', said('voice.registry.workersRequired'));
  if (idle) units = units.filter((entity) => entity.kind === 'villager' && ['idle', 'stop'].includes(entity.order?.type || 'idle'));
  if (!units.length) fail('NO_UNITS', query ? said('voice.registry.noUnitsMatch', { query: String(query).slice(0, 80) }) : said('voice.registry.noUnitsSelected'));
  return units;
}

function producer(game, query, predicate) {
  const kind = query && buildingKind(query);
  if (query && !kind) { const entity = resolveEntity(game, query, { team: 1, buildingsOnly: true }); if (!predicate(entity)) fail('WRONG_PRODUCER', said('voice.registry.wrongProducer')); return entity; }
  let candidates = game.world.state.buildings.filter(entity => entity.team === 1 && entity.hp > 0 && entity.progress >= 1 && (!kind || entity.kind === kind) && predicate(entity));
  const selected = candidates.filter(entity => game.selectedIds.includes(entity.id)); if (selected.length) candidates = selected;
  candidates.sort((a, b) => a.queue.length - b.queue.length || nearestFirst(referencePoint(game))(a, b));
  if (!candidates.length) fail('PRODUCER_REQUIRED', said('voice.registry.producerRequired'));
  return candidates[0];
}
export function exportRegistry() { return structuredClone(TOOL_SPECS); }

export function createVoiceRegistry(game, options = {}) {
  // Game orders are direct by the user's explicit preference. Confirmation is
  // retained only for callers that deliberately opt into the earlier protocol.
  const mode = options.confirmationMode === 'confirmed' ? 'confirmed' : 'direct';
  const audit = [];
  const preparedReferences = new Map();
  let preparedCounter = 0;
  let lastDirectTargets = null;
  const selectionSignature = () => JSON.stringify([...game.selectedIds].sort());
  function executeAction(action, meta = {}) {
    let value;
    if (action.type === 'engine') {
      if (action.command === 'cancel_train') {
        const expected = preparedReferences.get(action.preparedKey);
        const current = game.world.getEntity(action.args.buildingId)?.queue[action.args.queueIndex];
        if (!expected || expected.world !== game.world || expected.entry !== current) return result(false, 'QUEUE_CHANGED', said('voice.registry.queueChanged'));
      }
      value = game.execute(action.command, action.args);
    }
    else if (action.type === 'new') value = game.newMatch(action.args);
    else if (action.type === 'save') {
      if (meta.ownsPause) game.execute('pause', { paused: meta.originalPaused });
      value = game.save();
    } else if (action.type === 'load') value = game.load(action.args.serialized);
    else return result(false, 'INVALID_ACTION', said('voice.registry.invalidAction'));
    const engineMessage = value?.message ? { text: value.message, ...(value.i18n ? { i18n: value.i18n } : {}) } : null;
    const response = result(Boolean(value?.ok), value?.ok ? 'EXECUTED' : 'ENGINE_REJECTED', value?.ok && mode === 'direct' ? action.successSpeak || said('voice.registry.done') : engineMessage || said(value?.ok ? 'voice.registry.executed' : 'voice.registry.engineRejected'), value?.ok ? { command: action.command || action.type } : undefined);
    if (value?.ok && mode === 'direct') lastDirectTargets = { world: game.world, generation: game.worldGeneration, epoch: confirm.sessionEpoch, selection: selectionSignature(), ids: [...(action.args.unitIds || [])] };
    audit.push({ ...meta, toolName: action.toolName, command: action.command || action.type, targetIds: action.args.unitIds || (action.args.unitId ? [action.args.unitId] : []), result: response.code }); if (audit.length > 50) audit.shift();
    return response;
  }
  const confirm = createConfirmStore({ game, ...options.confirmOptions, execute: executeAction });
  confirm.subscribe((value) => { if (value?.action.preparedKey && !['proposed','armed','countdown','executing'].includes(value.state)) preparedReferences.delete(value.action.preparedKey); });

  function prepare(tool, input) {
    if (!game.world && tool.name !== 'propose_new_match') fail('NO_MATCH', said('voice.registry.noMatch'));
    const state = game.world?.state;
    const action = { type: 'engine', toolName: tool.name, title: tool.title, lines: [], lineI18n: [], command: '', args: {} };
    // Each proposal line keeps its Spanish text in action.lines and its translatable twin in action.lineI18n.
    const line = (key, params) => { const value = said(key, params); action.lines.push(value.text); action.lineI18n.push(value.i18n); };
    let queueReference = null;
    const unitsFor = (settings = {}) => { const units = resolveUnits(game, input.target, settings); action.args.unitIds = units.map((entity) => entity.id); line('voice.line.unitsExact', { count: units.length }); for (const unit of units) line('voice.line.entity', { label: labelParam(unit) }); return units; };
    const resolve = (query, settings = {}) => resolveEntity(game, query, settings);
    const at = (units = [], defaultLocation) => { const point = semanticPoint(game, input, units, resolve, defaultLocation); Object.assign(action.args, point); line('voice.line.destination', { x: String(point.x), y: String(point.y) }); };
    const price = (value) => line('voice.line.cost', { cost: costParam(value) });
    switch (tool.name) {
      case 'propose_rename': { const unit = resolveEntity(game, input.target, { team: 1 }); if (!UNITS[unit.kind]) fail('UNIT_REQUIRED', said('voice.registry.renameUnitsOnly')); action.command = 'rename'; action.args = { unitId: unit.id, name: input.name.normalize('NFKC').trim().replace(/\s+/gu, ' ') }; line('voice.line.resident', { label: labelParam(unit) }); line('voice.line.newName', { name: action.args.name }); break; }
      case 'propose_move': { const units = unitsFor({ fallback: 'move' }); action.command = 'move'; at(units); action.args.attackMove = input.attackMove || false; action.args.formation = input.formation || (units.every(unit => unit.formation === units[0].formation) && units[0].formation) || 'box'; line(input.attackMove ? 'voice.line.attackMove' : 'voice.line.normalMove'); break; }
      case 'propose_formation': { const units = unitsFor({ fallback: 'move' }); action.command = 'formation'; action.args.kind = input.kind; if (input.destination || input.x !== undefined || input.y !== undefined) at(units); line('voice.line.formation', { formation: { es: { line: 'línea', box: 'caja', staggered: 'escalonada' }[input.kind], ref: { key: `voice.formation.${input.kind}` } } }); break; }
      case 'propose_gather': { const kind = input.resource || resourceKind(input.destination); const units = unitsFor({ fallback: kind === 'fish' ? 'fish' : 'gather' }); let node = input.targetId ? resolveEntity(game, input.targetId) : null; if (!node && kind) node = nearestResource(game, kind, units); if (!node) fail('RESOURCE_REQUIRED', said('voice.registry.resourceRequired')); action.command = 'gather'; action.args.targetId = node.id; line('voice.line.resourceExact', { label: labelParam(node), x: String(node.x), y: String(node.y) }); line('voice.line.gatherCycle'); break; }
      case 'propose_build': case 'propose_wall': {
        let units = resolveUnits(game, input.target, { workers: true, allWorkers: true });
        const automatic = !input.target && !units.some(unit => game.selectedIds.includes(unit.id));
        action.command = tool.name === 'propose_wall' ? 'wall' : 'build'; action.args.kind = input.kind;
        const { builderId, ...point } = constructionPoint(game, input, units, resolve, action.command === 'wall', automatic);
        if (automatic) units = builderId ? units.filter(unit => unit.id === builderId) : units.slice(0, 1);
        action.args.unitIds = units.map(unit => unit.id);
        line('voice.line.unitsExact', { count: units.length }); for (const unit of units) line('voice.line.entity', { label: labelParam(unit) });
        Object.assign(action.args, point); line('voice.line.destination', { x: String(point.x), y: String(point.y) });
        let count = 1;
        if (action.command === 'wall') { count = Math.max(Math.abs(point.endX - point.x), Math.abs(point.endY - point.y)) + 1; line('voice.line.wallEnd', { x: String(point.endX), y: String(point.endY), count, building: kindParam(input.kind) }); }
        else line('voice.line.footprint', { building: kindParam(input.kind), size: BUILDINGS[input.kind].size });
        price(multiply(BUILDINGS[input.kind].cost, count)); break;
      }
      case 'propose_repair': { unitsFor({ workers: true }); action.command = 'repair'; const source = resolveEntity(game, input.building, { team: 1, buildingsOnly: true }); action.args.targetId = source.id; line('voice.line.building', { label: labelParam(source) }); if (source.progress < 1) line('voice.line.resumeConstruction'); else { action.args.budgetWood = (source.maxHp - source.hp) * .08; line('voice.line.repairBudget', { budget: String(Number(action.args.budgetWood.toFixed(4))) }); line('voice.line.repairStops'); } break; }
      case 'propose_train': { const source = producer(game, input.building, (entity) => BUILDINGS[entity.kind].trains?.includes(input.kind)); action.command = 'train'; action.args = { buildingId: source.id, kind: input.kind, quantity: input.quantity }; line('voice.line.producer', { label: labelParam(source) }); line('voice.line.recruits', { count: input.quantity, unit: kindParam(input.kind) }); line('voice.line.reservedPopulation', { count: input.quantity }); price(multiply(UNITS[input.kind].cost, input.quantity)); break; }
      case 'propose_cancel_train': { const source = resolveEntity(game, input.building, { team: 1, buildingsOnly: true }); const entry = source.queue[input.queueIndex]; if (!entry) fail('QUEUE_NOT_FOUND', said('voice.registry.queueNotFound')); queueReference = { world: game.world, entry }; action.command = 'cancel_train'; action.args = { buildingId: source.id, queueIndex: input.queueIndex }; line('voice.line.queueEntry', { label: labelParam(source), index: input.queueIndex, kind: { es: entry.kind, ref: { kind: entry.kind } } }); line('voice.line.refund', { cost: costParam(entry.cost) }); break; }
      case 'propose_attack': case 'propose_convert': { const units = unitsFor({ fallback: tool.name === 'propose_attack' ? 'military' : 'convert' }); action.command = tool.name === 'propose_attack' ? 'attack' : 'convert'; const enemy = resolveEntity(game, input.enemy || 'enemigo más cercano', { team: 2, origin: referencePoint(game, units) }); action.args.targetId = enemy.id; line('voice.line.enemyExact', { label: labelParam(enemy), x: enemy.x.toFixed(1), y: enemy.y.toFixed(1) }); break; }
      case 'propose_defend': unitsFor({ fallback: 'military' }); action.command = 'defend'; if (input.anchor) { const anchor = resolveEntity(game, input.anchor, { team: 1, buildingsOnly: true }); action.args.targetId = anchor.id; line('voice.line.defend', { label: labelParam(anchor) }); } else if (input.x !== undefined || input.y !== undefined) { if (input.x === undefined || input.y === undefined) fail('POSITION_REQUIRED', said('voice.semantic.placeRequired')); at(); } else line('voice.line.defendCurrent'); break;
      case 'propose_stop_units': unitsFor(); action.command = 'stop'; line('voice.line.stopOrders'); break;
      case 'propose_cast': {
        let units = unitsFor({ fallback: input.spell });
        action.command = 'cast'; action.args.spell = input.spell;
        at(units, input.spell === 'heal' ? 'heridos' : 'enemigo más cercano');
        if (!input.target && !units.some(u => game.selectedIds.includes(u.id))) {
          units = [...units].sort((a, b) => Number(b.mana >= 35) - Number(a.mana >= 35) || nearestFirst(action.args)(a, b)).slice(0, 1);
          action.args.unitIds = units.map(u => u.id);
        }
        const naturalHeal = input.spell === 'heal' && !explicitPoint(input);
        if (naturalHeal && units.every(u => UNITS[u.kind].spell === 'heal') && units.some(u => Math.hypot(u.x - action.args.x, u.y - action.args.y) > UNITS[u.kind].range + 1)) {
          action.command = 'move'; delete action.args.spell;
          action.successSpeak = said('voice.registry.healersOnTheWay');
          line('voice.line.healApproach');
        } else {
          line('voice.line.spell', { spell: { es: input.spell === 'heal' ? 'Sanación' : 'Bola de fuego', ref: { key: input.spell === 'heal' ? 'voice.spell.heal' : 'voice.spell.fireball' } } });
          price({ mana: units.length * 35 });
        }
        break;
      }
      case 'propose_rally': {
        const source = producer(game, input.building, entity => BUILDINGS[entity.kind].trains?.length);
        action.command = 'rally'; action.args.buildingId = source.id;
        const point = explicitPoint(input), kind = resourceKind(input.destination), farmDestination = buildingKind(input.destination) === 'farm';
        if (input.targetId || kind || farmDestination) {
          let target = input.targetId ? resolveEntity(game, input.targetId) : null;
          if (!target && farmDestination) target = resolve(input.destination, { team: 1, buildingsOnly: true, origin: source });
          if (!target && kind) {
            const worker = BUILDINGS[source.kind].trains.find(id => UNITS[id].gatherRate && (kind === 'fish' ? id === 'fishing_boat' : id !== 'fishing_boat'));
            const movement = UNITS[worker || BUILDINGS[source.kind].trains[0]].movement;
            const origin = game.world.navigation.nearest(source.x + BUILDINGS[source.kind].size + .5, source.y + BUILDINGS[source.kind].size + .5, movement, 20);
            if (origin) target = nearestResource(game, kind, [{ ...origin, kind: worker || BUILDINGS[source.kind].trains[0] }]);
          }
          if (!target) fail('RESOURCE_REQUIRED', said('voice.semantic.noResource'));
          action.args.targetId = target.id;
          line('voice.line.rallyResource', { label: labelParam(target) });
        } else if (point) Object.assign(action.args, point);
        else at();
        line('voice.line.producerExact', { label: labelParam(source) }); break;
      }
      case 'propose_research': { const definition = TECHNOLOGIES[input.technologyId]; const source = producer(game, input.building, (entity) => entity.kind === definition.producer); action.command = 'research'; action.args = { buildingId: source.id, technologyId: input.technologyId }; line('voice.line.technology', { technology: { es: definition.name, ref: { key: `data.tech.${input.technologyId}` } } }); line('voice.line.researchBuilding', { label: labelParam(source), age: definition.age }); price(definition.cost); break; }
      case 'propose_advance_age': { const source = producer(game, input.building, (entity) => entity.kind === 'guildhall'); action.command = 'advance_age'; action.args = { buildingId: source.id }; line('voice.line.ageHall', { label: labelParam(source), age: state.teams[1].age + 1 }); price(AGE_COSTS[state.teams[1].age + 1] || {}); break; }
      case 'propose_trade': { const rate = state.teams[1].upgrades.trade_routes ? .8 : 1; const gold = input.direction === 'buy' ? Math.ceil(input.amount * 1.5 * rate) : Math.floor(input.amount * .65 / rate); action.command = 'trade'; action.args = { ...input }; line(input.direction === 'buy' ? 'voice.line.tradeBuy' : 'voice.line.tradeSell', { amount: String(input.amount), resource: { es: input.resource, ref: { key: `data.resource.${input.resource}` } }, gold: String(gold) }); break; }
      case 'propose_gate': { const source = resolveEntity(game, input.building, { team: 1, buildingsOnly: true }); action.command = 'gate'; action.args = { buildingId: source.id, open: input.open }; line(input.open ? 'voice.line.gateOpen' : 'voice.line.gateClose', { label: labelParam(source) }); break; }
      case 'propose_pause': action.command = 'pause'; action.args = { paused: input.paused }; line(input.paused ? 'voice.line.pause' : 'voice.line.resume'); break;
      case 'propose_speed': action.command = 'speed'; action.args = { speed: input.speed }; line('voice.line.speed', { speed: { es: String(input.speed), ref: String(input.speed) } }); break;
      case 'propose_new_match': action.type = 'new'; action.args = { ...input }; line('voice.line.region', { map: { es: MAPS.find((map) => map.id === input.mapId).name, ref: { key: `data.map.${input.mapId}.name` } } }); line('voice.line.guild', { guild: { es: GUILDS.find((guild) => guild.id === input.guildId).name, ref: { key: `data.guild.${input.guildId}.name` } }, difficulty: input.difficulty, mode: input.mode }); line('voice.line.replaceWarning'); break;
      case 'propose_save': action.type = 'save'; line('voice.line.save', { map: { es: state.mapId, ref: { key: `data.map.${state.mapId}.name` } }, population: game.world.summary(1).population }); line('voice.line.saveCopy'); break;
      case 'propose_load': { let saved; try { saved = JSON.parse(globalThis.localStorage?.getItem('gremios-save')); World.fromSave(saved); } catch { fail('SAVE_INVALID', said('voice.registry.saveInvalid')); } action.type = 'load'; action.args = { serialized: saved }; line('voice.line.load', { map: { es: saved.mapId, ref: { key: `data.map.${saved.mapId}.name` } } }); break; }
      default: fail('UNKNOWN_TOOL', said('voice.registry.noExecutor'));
    }
    if (mode === 'confirmed' && action.type === 'engine') {
      // The opt-in protocol previews a detached World and revalidates on execution.
      // Direct orders validate once at the atomic live engine command boundary.
      const preview = World.fromSave(game.world.serialize()).command(action.command, action.args);
      if (!preview.ok) fail('ENGINE_REJECTED', { text: preview.message, ...(preview.i18n ? { i18n: preview.i18n } : {}) });
    }
    if (queueReference) { action.preparedKey = `prepared-queue-${++preparedCounter}`; preparedReferences.set(action.preparedKey, queueReference); }
    return action;
  }

  function immediate(tool, input) {
    if (mode === 'direct' && tool.name === 'confirm_action') return result(true, 'NO_CONFIRMATION_NEEDED', said('voice.registry.alreadyDone'));
    if (mode === 'direct' && tool.name === 'stop_action') {
      if (!game.world) return result(false, 'NO_MATCH', said('voice.registry.noMatch'));
      const own = game.world.state.units.filter((unit) => unit.team === 1 && unit.hp > 0);
      const selected = own.filter((unit) => game.selectedIds.includes(unit.id));
      const previous = lastDirectTargets?.world === game.world && lastDirectTargets.generation === game.worldGeneration && lastDirectTargets.epoch === confirm.sessionEpoch && lastDirectTargets.selection === selectionSignature() ? own.filter((unit) => lastDirectTargets.ids.includes(unit.id)) : [];
      const units = previous.length ? previous : selected;
      if (!units.length) return result(true, 'NO_ACTIVE_UNITS', said('voice.registry.noActiveUnits'), { rollback: false });
      const stopped = executeAction({ type: 'engine', toolName: 'stop_action', command: 'stop', args: { unitIds: units.map((unit) => unit.id) } }, { source: 'voice', worldGeneration: game.worldGeneration, sessionEpoch: confirm.sessionEpoch });
      return stopped.ok ? result(true, 'UNITS_STOPPED', said('voice.registry.unitsStopped'), { count: units.length, rollback: false }) : stopped;
    }
    if (tool.name === 'confirm_action') { const value = confirm.arm(input.proposalId, input.confirmationText); return value ? result(true, 'ARMED', said('voice.registry.armed'), { proposalId: value.proposalId, worldGeneration: value.worldGeneration, sessionEpoch: value.sessionEpoch }) : result(false, 'NO_PENDING_PROPOSAL', said('voice.registry.proposalGone')); }
    if (tool.name === 'stop_action') { const value = confirm.stop(input.proposalId); return result(Boolean(value), value ? value.state.toUpperCase() : 'NO_PENDING_PROPOSAL', value?.result?.speak ? { text: value.result.speak, ...(value.result.i18n ? { i18n: value.result.i18n } : {}) } : said('voice.registry.noPendingProposal')); }
    if (tool.name === 'configure_match') {
      for (const [key, field] of Object.entries({ mapId: 'map', guildId: 'guild', difficulty: 'difficulty', mode: 'mode' })) if (input[key] !== undefined) { const control = document.querySelector(`[name="${field}"][value="${input[key]}"]`) || document.querySelector(`select[name="${field}"]`); if (control) { if (control.type === 'radio') control.checked = true; else control.value = input[key]; control.dispatchEvent(new Event('change', { bubbles: true })); } }
      return result(true, 'VIEW_CHANGED', said('voice.registry.matchPrepared'));
    }
    if (tool.name === 'open_panel') { if (['close','menu','continue'].includes(input.panel)) game.view({ close: 'close-panel', menu: 'return-menu', continue: 'continue-world' }[input.panel]); else game.openPanel(input.panel); if (input.panel === 'roster' && input.query) game.view('roster-search', { query: input.query }); return result(true, 'VIEW_CHANGED', said('voice.registry.panelView', { panel: input.panel })); }
    if (tool.name === 'read_catalog') {
      const catalog = { units: UNITS, buildings: BUILDINGS, technologies: TECHNOLOGIES, maps: MAPS, guilds: GUILDS }[input.category];
      const rows = (Array.isArray(catalog) ? catalog : Object.entries(catalog).map(([id, definition]) => ({ id, ...definition }))).filter((entry) => !input.query || normalize(`${entry.id} ${entry.name}`).includes(normalize(input.query))).slice(0, 24).map((entry) => ({ id: entry.id, name: entry.name, age: entry.age, cost: entry.cost, role: entry.role, description: entry.description }));
      const nameRef = (entry) => input.category === 'technologies' ? { key: `data.tech.${entry.id}` } : input.category === 'maps' ? { key: `data.map.${entry.id}.name` } : input.category === 'guilds' ? { key: `data.guild.${entry.id}.name` } : { kind: entry.id };
      return result(true, 'READ', rows.length ? said('voice.line.entity', { label: listParam(rows.map((entry) => ({ text: entry.name, i18n: { key: 'voice.line.entity', params: { label: nameRef(entry) } } }))) }) : said('voice.registry.noMatches'), rows);
    }
    if (!game.world) return result(false, 'NO_MATCH', said('voice.registry.noMatch'));
    if (tool.name === 'read_city') { const summary = game.world.summary(1); return result(true, 'READ', said('voice.registry.city', { age: summary.age, population: summary.population, capacity: summary.capacity, reserved: summary.reservedPopulation, resources: costParam(summary.resources) }), { ...summary, paused: game.world.state.paused, mapId: game.world.state.mapId }); }
    if (tool.name === 'read_roles') { const roles = Object.entries(UNITS).map(([kind, definition]) => ({ kind, name: definition.name, count: game.world.state.units.filter((unit) => unit.team === 1 && unit.kind === kind && unit.hp > 0).length, aliases: ROLE_ALIASES[kind] })).filter((entry) => entry.count); return result(true, 'READ', said('voice.line.entity', { label: listParam(roles.map((entry) => said('voice.registry.roleCount', { count: entry.count, unit: kindParam(entry.kind) }))) }), roles); }
    if (tool.name === 'read_residents') { const kind = input.role ? unitKind(input.role) : null; if (input.role && !kind && !['militares','ejercito'].includes(bare(input.role))) return result(false, 'ROLE_NOT_FOUND', said('voice.registry.roleNotFound')); const rows = game.world.state.units.filter((unit) => unit.team === 1 && unit.hp > 0 && (!input.query || normalize(unit.name).includes(normalize(input.query))) && (!input.role || kind ? !kind || unit.kind === kind : UNITS[unit.kind].role !== 'worker')).slice(0, input.limit || 12).map((unit) => ({ id: unit.id, name: unit.name, kind: unit.kind, hp: unit.hp, order: unit.order.type })); return result(true, 'READ', rows.length ? said('voice.line.entity', { label: listParam(rows.map((unit) => said('voice.registry.residentRow', { name: unit.name, unit: kindParam(unit.kind) })), 'voice.list.semicolon') }) : said('voice.registry.noResidents'), rows); }
    if (tool.name === 'read_entity') { const entity = resolveEntity(game, input.target); const data = { id: entity.id, name: entity.name, kind: entity.kind, team: entity.team, hp: entity.hp, maxHp: entity.maxHp, x: entity.x, y: entity.y, order: entity.order, carry: entity.carry, formation: entity.formation, rally: entity.rally, amount: entity.amount }; const health = entity.hp ? said('voice.registry.entityHealth', { hp: Math.ceil(entity.hp) }) : null; return result(true, 'READ', said('voice.registry.entity', { label: labelParam(entity), x: entity.x.toFixed(1), y: entity.y.toFixed(1), health: health ? { es: health.text, ref: health.i18n } : '' }), data); }
    if (tool.name === 'select_units') { const units = resolveUnits(game, input.target, { idle: input.idle }); const ids = units.map((entity) => entity.id); game.select(input.mode === 'add' ? [...game.selectedIds, ...ids] : ids); lastDirectTargets = null; return result(true, 'SELECTED', mode === 'direct' ? said('voice.registry.selected') : said('voice.registry.selectedList', { count: units.length, names: listParam(units.slice(0, 5).map((entity) => entity.name)) }), { count: units.length, ids: ids.slice(0, 20) }); }
    if (tool.name === 'camera_view') { if (!game.renderer) fail('NO_RENDERER', said('voice.registry.cameraNotReady')); if (input.action === 'zoom') { if (input.factor === undefined) fail('FACTOR_REQUIRED', said('voice.registry.zoomFactorRequired')); game.renderer.zoomAt(input.factor); } else if (input.action === 'pan') game.renderer.pan(input.dx || 0, input.dy || 0); else if (input.action === 'selection') game.view('center-selection'); else { const entity = input.target ? resolveEntity(game, input.target) : null; if (!entity && (input.x === undefined || input.y === undefined)) fail('POSITION_REQUIRED', said('voice.semantic.placeRequired')); game.renderer.centerOn(entity?.x ?? input.x, entity?.y ?? input.y); } return result(true, 'VIEW_CHANGED', said('voice.registry.cameraDone')); }
    if (tool.name === 'control_group') { const value = game.view(input.action === 'assign' ? 'assign-group' : 'recall-group', { group: input.group }); if (input.action === 'recall') lastDirectTargets = null; return result(value?.ok !== false, 'VIEW_CHANGED', said(input.action === 'assign' ? 'voice.registry.groupSaved' : 'voice.registry.groupSelected', { group: input.group })); }
    if (tool.name === 'show_catalog') { game.view('tab', { tab: input.tab }); return result(true, 'VIEW_CHANGED', said('voice.registry.showingCategory', { tab: input.tab })); }
    return result(false, 'UNKNOWN_TOOL', said('voice.registry.unknownTool'));
  }

  function runTool(name, input = {}, context = {}) {
    const tool = TOOL_SPECS.find((entry) => entry.name === name);
    if (!tool) return result(false, 'UNKNOWN_TOOL', said('voice.registry.unknownTool'));
    if (!tool.allowedRoles.includes(context.role || 'commander')) return result(false, 'ROLE_REJECTED', said('voice.registry.roleRejected'));
    if (context.signal?.aborted) return result(false, 'ABORTED', said('voice.registry.aborted'));
    const errors = validateSchema(tool.inputSchema, input); if (errors.length) return result(false, 'INVALID_INPUT', said('voice.registry.invalidInput', { errors: errors.slice(0, 3).join('; ') }));
    try {
      if (tool.kind !== 'consequential' || tool.name === 'stop_action') return immediate(tool, input);
      const action = prepare(tool, structuredClone(input));
      if (mode === 'direct') {
        try { return executeAction(action, { source: context.source || 'voice', worldGeneration: game.worldGeneration, sessionEpoch: confirm.sessionEpoch }); }
        finally { if (action.preparedKey) preparedReferences.delete(action.preparedKey); }
      }
      const proposal = confirm.propose(action);
      if (context.signal) {
        const abort = () => confirm.stop(proposal.proposalId); context.signal.addEventListener('abort', abort, { once: true });
        const unsubscribe = confirm.subscribe((value) => { if (value?.proposalId !== proposal.proposalId || !['proposed','armed','countdown'].includes(value.state)) { context.signal.removeEventListener('abort', abort); unsubscribe(); } });
      }
      const details = action.lines.map((text, index) => ({ text, i18n: action.lineI18n[index] })).filter((entry) => /Coste:|Reclutas:|Destino:|Nombre nuevo:|Edificio:|Final:/u.test(entry.text));
      return result(true, 'PROPOSED', said('voice.registry.proposed', { title: { es: tool.title, ref: { key: `voice.tool.${tool.name}` } }, details: listParam(details, { text: ' ' }) }), { proposalId: proposal.proposalId, worldGeneration: proposal.worldGeneration, sessionEpoch: proposal.sessionEpoch, title: action.title, targetCount: action.args.unitIds?.length || 1, lines: action.lines.length > 12 ? [...action.lines.slice(0, 3), said('voice.registry.exactListOnScreen', { count: action.args.unitIds?.length || 0 }).text, ...action.lines.slice(-4)] : action.lines });
    } catch (error) { return result(false, error.code || 'TOOL_REJECTED', error.code ? failure(error) : said('voice.registry.toolRejected'), error.data); }
  }
  return { mode, runTool, confirm, exportRegistry, getAudit: () => structuredClone(audit) };
}
