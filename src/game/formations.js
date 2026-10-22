import { UNITS } from './data.js';

export const FORMATIONS = Object.freeze(['line', 'box', 'staggered']);

const SPACING = .5;
const RADIUS = .2;
const MIN_SEPARATION = .45;
const ROLE_RANK = { heavy: 0, infantry: 0, cavalry: 0, assassin: 1, naval: 1, worker: 2, ranged: 2, magic: 3, wizard: 3, healer: 4, siege: 4 };
const compareId = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Original group geometry. Shared anchor routes stay separate from exact arrival slots. */
export function planFormation(world, units, destination, kind) {
  if (!FORMATIONS.includes(kind)) throw new RangeError('Unknown formation');
  const { width, height } = world.state.map;
  if (!Number.isFinite(destination.x) || !Number.isFinite(destination.y)) throw new TypeError('Invalid formation destination');
  const requested = {
    x: Math.max(0, Math.min(width - .00001, destination.x)),
    y: Math.max(0, Math.min(height - .00001, destination.y)),
  };
  const selected = new Set(units.map(unit => unit.id));
  const occupied = new Uint8Array(width * height);
  for (const unit of world.state.units) if (unit.hp > 0 && !selected.has(unit.id)) {
    occupied[Math.floor(unit.y) * width + Math.floor(unit.x)] = 1;
  }
  const assignments = new Map();
  for (const movement of ['land', 'water']) {
    const members = units.filter(unit => UNITS[unit.kind].movement === movement).sort(compareId);
    if (!members.length) continue;
    const marchSpeed = Math.min(...members.map(unit => UNITS[unit.kind].speed));
    const anchor = world.navigation.nearest(requested.x, requested.y, movement, Math.max(width, height));
    // Normalizing before field() prevents blocked destinations from seeding disjoint components.
    const field = anchor ? world.navigation.field(anchor.x, anchor.y, movement) : null;
    const record = (unit, goal, reachable) => assignments.set(unit.id, {
      unit, x: goal.x, y: goal.y,
      anchorX: anchor?.x ?? requested.x, anchorY: anchor?.y ?? requested.y,
      marchSpeed, reachable,
    });
    const reachable = [];
    for (const unit of members) {
      const at = Math.floor(unit.y) * width + Math.floor(unit.x);
      if (field && field.distance[at] >= 0) reachable.push(unit);
      else record(unit, requested, false);
    }
    if (!reachable.length) continue;

    const center = members.reduce((point, unit) => ({ x: point.x + unit.x / members.length, y: point.y + unit.y / members.length }), { x: 0, y: 0 });
    const dx = requested.x - center.x, dy = requested.y - center.y, length = Math.hypot(dx, dy);
    const forward = length > 1e-8 ? { x: dx / length, y: dy / length } : { x: 0, y: 1 };
    const right = { x: forward.y, y: -forward.x };
    const lateral = unit => unit.x * right.x + unit.y * right.y;
    reachable.sort((a, b) => (ROLE_RANK[UNITS[a.kind].role] ?? 2) - (ROLE_RANK[UNITS[b.kind].role] ?? 2) || lateral(a) - lateral(b) || compareId(a, b));
    const columns = Math.min(reachable.length, kind === 'line' ? Math.min(48, Math.ceil(Math.sqrt(reachable.length) * 2)) : Math.ceil(Math.sqrt(reachable.length)));
    const rows = Math.ceil(reachable.length / columns);
    const slots = reachable.map((unit, index) => {
      const row = Math.floor(index / columns), count = Math.min(columns, reachable.length - row * columns);
      return { unit, across: (index % columns - (count - 1) / 2 + (kind === 'staggered' && row % 2 ? .5 : 0)) * SPACING, depth: ((rows - 1) / 2 - row) * SPACING };
    });
    const meanAcross = slots.reduce((sum, slot) => sum + slot.across, 0) / slots.length;
    const meanDepth = slots.reduce((sum, slot) => sum + slot.depth, 0) / slots.length;
    const reserved = new Map();
    const cellKey = (x, y) => `${x}:${y}`;
    const separated = point => {
      const bx = Math.floor(point.x / MIN_SEPARATION), by = Math.floor(point.y / MIN_SEPARATION);
      for (let y = by - 1; y <= by + 1; y++) for (let x = bx - 1; x <= bx + 1; x++) {
        for (const other of reserved.get(cellKey(x, y)) || []) {
          if ((point.x - other.x) ** 2 + (point.y - other.y) ** 2 < MIN_SEPARATION ** 2 - 1e-9) return false;
        }
      }
      return true;
    };
    const legal = point => {
      if (point.x < RADIUS || point.y < RADIUS || point.x > width - RADIUS || point.y > height - RADIUS) return false;
      const at = Math.floor(point.y) * width + Math.floor(point.x);
      if (occupied[at] || field.distance[at] < 0) return false;
      // The square enclosing the physical radius must fit through the surrounding cells.
      for (const y of [point.y - RADIUS, point.y + RADIUS]) for (const x of [point.x - RADIUS, point.x + RADIUS]) {
        const tx = Math.floor(x), ty = Math.floor(y);
        if (!world.navigation.walkable(tx, ty, movement) || occupied[ty * width + tx]) return false;
      }
      return true;
    };
    const reserve = (unit, point) => {
      const key = cellKey(Math.floor(point.x / MIN_SEPARATION), Math.floor(point.y / MIN_SEPARATION));
      let bucket = reserved.get(key);
      if (!bucket) reserved.set(key, bucket = []);
      bucket.push(point); record(unit, point, true);
    };
    const pending = [];
    for (const slot of slots) {
      const across = slot.across - meanAcross, depth = slot.depth - meanDepth;
      const point = { x: anchor.x + right.x * across + forward.x * depth, y: anchor.y + right.y * across + forward.y * depth };
      if (legal(point) && separated(point)) reserve(slot.unit, point);
      else pending.push(slot.unit);
    }
    if (pending.length) {
      // One bounded map inventory, never a map scan or full navigation field per member.
      const candidates = [];
      for (let y = .25; y < height; y += SPACING) for (let x = .25; x < width; x += SPACING) {
        const point = { x, y };
        if (legal(point)) candidates.push(point);
      }
      candidates.sort((a, b) => (a.x - anchor.x) ** 2 + (a.y - anchor.y) ** 2 - (b.x - anchor.x) ** 2 - (b.y - anchor.y) ** 2 || b.x * forward.x + b.y * forward.y - a.x * forward.x - a.y * forward.y || a.x - b.x || a.y - b.y);
      let next = 0;
      for (const unit of pending) {
        while (next < candidates.length && !separated(candidates[next])) next++;
        if (next < candidates.length) reserve(unit, candidates[next++]);
        else record(unit, requested, false);
      }
    }
  }
  return units.map(unit => assignments.get(unit.id));
}
