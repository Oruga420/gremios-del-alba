import { World } from '../src/game/world.js';
import { UNITS, TERRAIN } from '../src/game/data.js';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const TEAMS = [1, 2];
const DT = .05;
const PHASES = [
  { kind: 'box', at: 0, goals: { 1: { x: 28, y: 23 }, 2: { x: 52, y: 57 } } },
  { kind: 'line', at: 40, goals: { 1: { x: 28, y: 40 }, 2: { x: 52, y: 40 } } },
  { kind: 'staggered', at: 80, goals: { 1: { x: 28, y: 57 }, 2: { x: 52, y: 23 } } },
];
const SOURCE_FILES = ['src/game/world.js', 'src/game/navigation.js', 'src/game/formations.js', 'src/game/data.js', 'scripts/benchmark-formations.mjs'];
const REPORT = new URL('../docs/reports/formations-benchmark.json', import.meta.url);
const alive = (world, team) => world.state.units.filter(unit => unit.hp > 0 && unit.team === team);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const problem = (metadata, message) => { if (!metadata.problems.includes(message)) metadata.problems.push(message); };
const percentile = (sorted, value) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] || 0;

function completed(pathRecord) {
  return pathRecord.record.status === (pathRecord.expectedUnreachable ? 'unreachable' : 'arrived');
}

/** A separate movement/economy fixture; the original combat benchmark is unchanged. */
export function createFormationBenchmarkWorld(seed = 20261021) {
  const world = new World({ mapId: 'llanuras-de-otono', mode: 'peaceful', difficulty: 'easy', seed });
  world.state.units = []; world.state.buildings = []; world.state.nodes = [];
  world.state.navigation = []; world.state.projectiles = []; world.state.effects = [];
  world.state.map.terrain.fill(TERRAIN.GRASS);
  world._indexes(); world.navigation.rebuild();
  const metadata = {
    seed, dt: DT, startedAt: new Date().toISOString(), nextPhase: 0,
    fixture: {
      mode: 'peaceful', terrain: 'Open grass with city-edge buildings and two eight-wall enclosed target cells',
      populationPerCity: 1000, militaryPerCity: 700, economicWorkersPerCity: 250, buildersPerCity: 50,
      ai: 'Native AI remains enabled; peaceful mode prevents military attack reassignment. Economic AI may reassign workers and construct houses.',
      overrides: 'Only fixture state/setup; no engine methods, clocks, AI functions or navigation functions are replaced.',
      scope: 'Explicit formation movement and active economy. Combat, all ten maps and conquest AI remain covered separately by scripts/benchmark.mjs.',
      movementSampling: 'Every living unit center on every tick; full previous-to-current segments sampled while the navigation epoch is unchanged.',
    },
    participants: {}, enclosed: {}, phases: [], paths: [], pendingPaths: [], problems: [], transitionBlocks: [],
    movementSamples: 0, segmentSamples: 0, segmentSamplesSkippedForNavigationChanges: 0,
    maxNewFieldsPerStep: 0, overCapRejected: false,
  };
  for (const team of TEAMS) {
    world.state.teams[team].age = 4;
    world.state.teams[team].resources = { wood: 100000, food: 100000, gold: 100000, stone: 100000 };
    world._building('guildhall', team, team === 1 ? 12 : 64, team === 1 ? 2 : 72, 1);
    for (let y = 1; y <= 76 && world.summary(team).capacity < 1000; y += 3) {
      for (const x of team === 1 ? [1, 4, 7, 10] : [68, 71, 74, 77]) {
        if (world.summary(team).capacity >= 1000) break;
        assert(world.canPlace('house', x, y), 'Capacity fixture requires legal house plots');
        world._building('house', team, x, y, 1);
      }
    }
    const x = team === 1 ? 16 : 62;
    for (const [kind, y] of team === 1 ? [['lumber_camp', 12], ['mill', 16], ['mining_camp', 20]] : [['lumber_camp', 64], ['mill', 60], ['mining_camp', 56]]) {
      assert(world.canPlace(kind, x, y), 'Economy fixture requires legal depots');
      world._building(kind, team, x, y, 1);
    }
    for (const [kind, y] of team === 1 ? [['wood', 12.5], ['food', 16.5], ['gold', 20.5], ['stone', 24.5]] : [['wood', 65.5], ['food', 61.5], ['gold', 57.5], ['stone', 53.5]]) {
      world._node(kind, team === 1 ? 19.5 : 60.5, y, 100000);
    }
    const center = team === 1 ? { x: 25, y: 4 } : { x: 55, y: 75 };
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dx || dy) world._building('wall', team, center.x + dx, center.y + dy, 1);
    }
    metadata.enclosed[team] = { ...center, unitIds: [] };
  }
  world.navigation.rebuild();
  for (const team of TEAMS) {
    const cohort = metadata.participants[team] = { economy: [], builders: [], military: [], formation: [] };
    for (let i = 0; i < 250; i++) {
      const unit = world._spawn('villager', team, team === 1 ? 17 : 65, team === 1 ? 10 : 69);
      assert(unit, 'Economic fixture spawn failed'); cohort.economy.push(unit.id);
    }
    for (let i = 0; i < 50; i++) {
      const unit = world._spawn('villager', team, team === 1 ? 14 : 64, team === 1 ? 32 : 45);
      assert(unit, 'Builder fixture spawn failed'); cohort.builders.push(unit.id);
    }
    for (let i = 0; i < 700; i++) {
      const kind = i % 8 === 0 ? 'healer' : i % 6 === 0 ? 'mage' : i % 4 === 0 ? 'archer' : 'heavy_knight';
      const unit = world._spawn(kind, team, team === 1 ? 28 : 52, team === 1 ? 12 : 68);
      assert(unit, 'Military fixture spawn failed'); cohort.military.push(unit.id);
      (i < 5 ? metadata.enclosed[team].unitIds : cohort.formation).push(unit.id);
    }
    for (let index = 0; index < 4; index++) {
      const kind = ['wood', 'food', 'gold', 'stone'][index];
      const target = world.state.nodes.find(node => node.kind === kind && (team === 1 ? node.x < 40 : node.x > 40));
      const ids = cohort.economy.filter((_, i) => i % 4 === index);
      const result = world._command('gather', { unitIds: ids, targetId: target.id }, team);
      assert(result.ok, `Economic order rejected: ${result.message}`);
    }
    for (let index = 0; index < 5; index++) {
      const result = world._command('build', {
        unitIds: cohort.builders.slice(index * 10, index * 10 + 10), kind: 'house',
        x: team === 1 ? 14 : 64, y: 34 + index * 3,
      }, team);
      assert(result.ok, `Construction order rejected: ${result.message}`);
    }
    assert(alive(world, team).length === 1000, `City ${team} must start with 1000 real units`);
  }
  metadata.overCapRejected = TEAMS.every(team => {
    const hall = world.state.buildings.find(building => building.team === team && building.kind === 'guildhall');
    return !world._command('train', { buildingId: hall.id, kind: 'villager' }, team).ok;
  });
  assert(metadata.overCapRejected, 'The 1001st inhabitant must be rejected');
  updateFormationBenchmark(world, metadata);
  World.fromSave(world.serialize());
  return { world, metadata };
}

function observePaths(world, metadata) {
  const now = performance.now();
  metadata.pendingPaths = metadata.pendingPaths.filter(entry => {
    if (entry.record.startedAt !== null && entry.wallFirstMovementSeconds === null) entry.wallFirstMovementSeconds = (now - entry.wallCommandedAt) / 1000;
    if (entry.record.resolvedAt === null) return true;
    entry.wallTerminalSeconds = (now - entry.wallCommandedAt) / 1000;
    const unit = world.getEntity(entry.unitId);
    if (entry.record.status === 'arrived' && (!unit || Math.hypot(unit.x - entry.goal.x, unit.y - entry.goal.y) > 1e-6)) {
      problem(metadata, `Arrival telemetry did not match exact destination: ${entry.phase}/${entry.unitId}`);
    }
    return false;
  });
}

/** Invoke before each actual world.tick(.05); this never advances the game clock itself. */
export function updateFormationBenchmark(world, metadata) {
  observePaths(world, metadata);
  const definition = PHASES[metadata.nextPhase];
  if (!definition || world.state.time + 1e-8 < definition.at) return;
  const previous = metadata.phases.at(-1);
  if (previous) {
    const unfinished = metadata.paths.filter(entry => entry.phase === previous.kind && !completed(entry));
    if (unfinished.length) {
      if (!metadata.transitionBlocks.some(block => block.kind === definition.kind)) {
        metadata.transitionBlocks.push({ kind: definition.kind, at: world.state.time, unfinished: unfinished.map(entry => ({ unitId: entry.unitId, status: entry.record.status })) });
        problem(metadata, `${definition.kind} transition reached with ${unfinished.length} unresolved/incorrect previous paths`);
      }
      return;
    }
  }
  const phase = { kind: definition.kind, scheduledAt: definition.at, issuedAt: world.state.time, teams: {} };
  const goals = new Set();
  for (const team of TEAMS) {
    const ids = metadata.participants[team].formation;
    phase.teams[team] = { living: alive(world, team).length, participantIds: [...ids], enclosedUnitIds: [...metadata.enclosed[team].unitIds] };
    for (const [unitIds, destination, expectedUnreachable] of [[ids, definition.goals[team], false], [metadata.enclosed[team].unitIds, metadata.enclosed[team], true]]) {
      const issued = performance.now();
      const result = world._command('move', { unitIds, x: destination.x, y: destination.y, formation: definition.kind }, team);
      if (!result.ok) { problem(metadata, `${definition.kind} city ${team} command rejected: ${result.message}`); continue; }
      for (const id of unitIds) {
        const unit = world.getEntity(id), record = world.state.navigation[unit?.navigationIndex];
        if (!unit || !record) { problem(metadata, `${definition.kind} lacks navigation record for ${id}`); continue; }
        const goal = { x: unit.order.x, y: unit.order.y };
        if (!expectedUnreachable) {
          const key = `${goal.x.toFixed(8)}:${goal.y.toFixed(8)}`;
          if (goals.has(key)) problem(metadata, `${definition.kind} destination duplicated: ${id}`);
          goals.add(key);
          if (!Number.isFinite(goal.x) || !Number.isFinite(goal.y) || goal.x < 0 || goal.y < 0 || goal.x >= 80 || goal.y >= 80 || !world.navigation.walkable(Math.floor(goal.x), Math.floor(goal.y), UNITS[unit.kind].movement)) {
            problem(metadata, `${definition.kind} destination is illegal: ${id}`);
          }
        }
        const entry = { phase: definition.kind, team, unitId: id, expectedUnreachable, goal, record, wallCommandedAt: issued, wallFirstMovementSeconds: null, wallTerminalSeconds: null };
        metadata.paths.push(entry); metadata.pendingPaths.push(entry);
      }
    }
  }
  metadata.phases.push(phase); metadata.nextPhase++;
  // Includes actual active orders, routes and descriptor queues in the production save validator.
  World.fromSave(world.serialize());
}

async function sourceDigests() {
  return Object.fromEntries(await Promise.all(SOURCE_FILES.map(async file => [file, createHash('sha256').update(await readFile(new URL('../' + file, import.meta.url))).digest('hex')])));
}

export async function runFormationBenchmark({ durationSeconds = 120, realtime = true } = {}) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3600) throw new RangeError('Duration must be greater than zero and at most one hour');
  const sourceBefore = await sourceDigests(), { world, metadata } = createFormationBenchmarkWorld();
  const previous = new Map(world.state.units.map(unit => [unit.id, { x: unit.x, y: unit.y }]));
  const samples = [], start = performance.now(), startTime = world.state.time;
  let deadline = start, navigationVersion = world.navigation.version;
  while ((realtime ? (performance.now() - start) / 1000 : world.state.time - startTime) < durationSeconds) {
    updateFormationBenchmark(world, metadata);
    const before = performance.now(); world.tick(DT); samples.push(performance.now() - before); deadline += 50;
    observePaths(world, metadata);
    const newFields = world.navigation.stats?.builtThisStep;
    if (!Number.isFinite(newFields)) problem(metadata, 'Per-step navigation build statistics are unavailable');
    else {
      metadata.maxNewFieldsPerStep = Math.max(metadata.maxNewFieldsPerStep, newFields);
      if (newFields > 8) problem(metadata, 'Navigation built more than eight full fields in a step');
    }
    for (const unit of world.state.units) {
      if (unit.hp <= 0) continue;
      const movement = UNITS[unit.kind].movement, prior = previous.get(unit.id);
      metadata.movementSamples++;
      if (!world.navigation.walkable(Math.floor(unit.x), Math.floor(unit.y), movement)) problem(metadata, `Unit entered an illegal terrain/building cell: ${unit.id}`);
      if (prior && navigationVersion === world.navigation.version) {
        metadata.segmentSamples++;
        if (!world.navigation.segmentClear(prior.x, prior.y, unit.x, unit.y, movement)) problem(metadata, `Unit crossed an illegal terrain/building segment: ${unit.id}`);
      } else if (prior) metadata.segmentSamplesSkippedForNavigationChanges++;
      if (prior) { prior.x = unit.x; prior.y = unit.y; } else previous.set(unit.id, { x: unit.x, y: unit.y });
    }
    navigationVersion = world.navigation.version;
    if (realtime) { const delay = deadline - performance.now(); if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay)); }
  }
  observePaths(world, metadata);
  const elapsedSeconds = (performance.now() - start) / 1000, simulatedSeconds = world.state.time - startTime;
  const sorted = samples.toSorted((a, b) => a - b), p95TickMs = percentile(sorted, .95), p99TickMs = percentile(sorted, .99);
  for (const phase of metadata.phases) for (const team of TEAMS) {
    if (phase.teams[team].living !== 1000) problem(metadata, `${phase.kind} city ${team} did not begin with 1000 living units`);
  }
  if (metadata.phases.length !== PHASES.length) problem(metadata, 'All three explicit formation phases were not exercised');
  for (const entry of metadata.paths) {
    const record = entry.record;
    if (!completed(entry)) problem(metadata, `Incorrect/unresolved ${entry.phase} path ${entry.unitId}: ${record.status}`);
    if (!entry.expectedUnreachable && (record.startedAt === null || record.startedAt - record.commandedAt > 2.5 || entry.wallFirstMovementSeconds === null || entry.wallFirstMovementSeconds > 2.5)) {
      problem(metadata, `Late/no initial movement ${entry.phase}/${entry.unitId}`);
    }
    if (record.resolvedAt === null || record.resolvedAt - record.commandedAt > 30 || entry.wallTerminalSeconds === null || entry.wallTerminalSeconds > 30) {
      problem(metadata, `Late/no terminal result ${entry.phase}/${entry.unitId}`);
    }
  }
  for (const phase of PHASES) for (const team of TEAMS) {
    if (metadata.paths.filter(entry => entry.phase === phase.kind && entry.team === team).length !== 700) problem(metadata, `${phase.kind} city ${team} lacks all 700 military paths`);
  }
  for (const team of TEAMS) if (alive(world, team).length !== 1000) problem(metadata, `City ${team} did not finish with 1000 living units`);
  if (world.state.metrics.gatherCycles < 100) problem(metadata, 'Fewer than 100 actual deposit cycles');
  if (world.state.metrics.constructionProgress < 10) problem(metadata, 'Fewer than 10 actual construction contributions');
  if (p95TickMs > 50) problem(metadata, 'Simulation p95 tick exceeded 50ms');
  if (realtime && simulatedSeconds < durationSeconds * .95) problem(metadata, 'Simulation did not maintain at least 95% of normal 20Hz progress');
  if (!metadata.overCapRejected) problem(metadata, 'The 1001st inhabitant was accepted');
  World.fromSave(world.serialize());
  const sourceAfter = await sourceDigests();
  if (JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter)) problem(metadata, 'Measured source files changed during the run');
  const acceptanceRun = realtime && durationSeconds >= 120;
  const evidence = {
    observedAt: new Date().toISOString(), status: metadata.problems.length ? 'FORMATION_BENCHMARK_FAILED' : acceptanceRun ? 'FORMATIONS_1000_OK' : 'FORMATION_DIAGNOSTIC_OK',
    ok: metadata.problems.length === 0, acceptanceRun, requestedDurationSeconds: durationSeconds, realtime,
    elapsedSeconds, simulatedSeconds, tickSampleCount: samples.length, p95TickMs, p99TickMs, maxTickMs: sorted.at(-1) || 0,
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
    sourceDigests: sourceAfter, sourceUnchanged: JSON.stringify(sourceBefore) === JSON.stringify(sourceAfter),
    fixture: metadata.fixture, seed: metadata.seed, dt: DT, phases: metadata.phases, transitionBlocks: metadata.transitionBlocks,
    liveCounts: Object.fromEntries(TEAMS.map(team => [team, alive(world, team).length])),
    navigation: { ...world.navigation.stats, observedMaxNewFieldsPerStep: metadata.maxNewFieldsPerStep },
    sampling: { movementSamples: metadata.movementSamples, segmentSamples: metadata.segmentSamples, segmentSamplesSkippedForNavigationChanges: metadata.segmentSamplesSkippedForNavigationChanges },
    metrics: world.state.metrics, expectedUnreachable: metadata.enclosed, overCapRejected: metadata.overCapRejected,
    paths: metadata.paths.map(({ wallCommandedAt, ...entry }) => entry), problems: metadata.problems,
    limitations: ['Peaceful controlled terrain fixture does not validate combat or all ten maps.', 'Movement sampling checks centers and motion segments; it does not prove continuous physical body collision freedom.', 'No browser rendering/FPS or voice acceptance is implied.', ...(!acceptanceRun ? ['Debug duration/non-realtime run cannot establish 120-second realtime acceptance.'] : [])],
  };
  await mkdir(new URL('../docs/reports/', import.meta.url), { recursive: true });
  await writeFile(REPORT, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ status: evidence.status, acceptanceRun, elapsedSeconds, simulatedSeconds, p95TickMs, p99TickMs,
    phases: metadata.phases.map(phase => ({ kind: phase.kind, issuedAt: phase.issuedAt, populations: Object.fromEntries(TEAMS.map(team => [team, phase.teams[team].living])) })),
    liveCounts: evidence.liveCounts, paths: evidence.paths.length, maxNewFieldsPerStep: metadata.maxNewFieldsPerStep,
    depositCycles: world.state.metrics.gatherCycles, problemCount: metadata.problems.length, problems: metadata.problems.slice(0, 12), report: fileURLToPath(REPORT),
  }, null, 2));
  return evidence;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const duration = process.argv.find(argument => argument.startsWith('--duration='));
  const result = await runFormationBenchmark({ durationSeconds: duration ? Number(duration.split('=')[1]) : 120, realtime: !process.argv.includes('--diagnostic') });
  if (!result.ok) process.exitCode = 1;
}
