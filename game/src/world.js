import { WORLD, MISSION, PALETTE } from './config.js';
import { range, int, pick } from './random.js';

const rect = (x, y, width, height) => ({ x, y, width, height });
const edges = r => ({ left: r.x - r.width / 2, right: r.x + r.width / 2,
  top: r.y - r.height / 2, bottom: r.y + r.height / 2 });
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** All static placement consumes only the supplied world stream. */
export function createWorld(rng) {
  const world = { width: WORLD.width, height: WORLD.height, roads: [], sidewalks: [],
    buildings: [], beach: rect((WORLD.beachX + WORLD.waterX) / 2, WORLD.height / 2,
      WORLD.waterX - WORLD.beachX, WORLD.height),
    water: rect((WORLD.waterX + WORLD.width) / 2, WORLD.height / 2,
      WORLD.width - WORLD.waterX, WORLD.height), docks: [], palms: [], roadNodes: [], solids: [] };
  const half = WORLD.roadWidth / 2;
  const sidewalk = WORLD.sidewalkWidth;
  for (const x of WORLD.roadXs) {
    world.roads.push(rect(x, WORLD.height / 2, WORLD.roadWidth, WORLD.height));
    for (const sign of [-1, 1]) world.sidewalks.push(rect(x + sign * (half + sidewalk / 2), WORLD.height / 2, sidewalk, WORLD.height));
  }
  for (const y of WORLD.roadYs) {
    world.roads.push(rect(WORLD.beachX / 2, y, WORLD.beachX, WORLD.roadWidth));
    for (const sign of [-1, 1]) world.sidewalks.push(rect(WORLD.beachX / 2, y + sign * (half + sidewalk / 2), WORLD.beachX, sidewalk));
  }
  // The delivery road continues onto a broad quay, with two connected piers.
  world.roads.push(rect((WORLD.beachX + WORLD.waterX) / 2, MISSION.docks.y,
    WORLD.waterX - WORLD.beachX, WORLD.roadWidth));
  world.docks.push(rect(WORLD.waterX + 100, WORLD.dockY, 240, 76),
    rect(WORLD.waterX + 100, MISSION.docks.y, 240, WORLD.roadWidth),
    rect(WORLD.waterX + 190, (WORLD.dockY + MISSION.docks.y) / 2, 60,
      MISSION.docks.y - WORLD.dockY + WORLD.roadWidth));

  const names = ['Coral Circuit', 'Velvet Flamingo', 'Moonwake Motel', 'Sunset Stereo', 'Pelican Post', 'Electric Orchid',
    'Mirage Motors', 'Palm Frequency', 'Marlin Market', 'Rosewater Rooms', 'Lucky Iguana', 'Harbor Vinyl',
    'Neon Noodles', 'Blue Comet', 'Seabreeze Arcade', 'Cobalt Couriers', 'Mango Moon', 'Pink Current',
    'Silver Heron', 'Tropic Torque', 'Lunar Laundry', 'Lagoon Lounge', 'Vice Vista', 'Amber Anchor',
    'Starlight Storage', 'Paradise Prints', 'Saffron Sail', 'Afterglow Autos', 'Driftwood Radio', 'Pearl Pavilion'];
  for (let row = 0; row < WORLD.roadYs.length; row++) {
    for (let col = 0; col < WORLD.roadXs.length; col++) {
      const left = col ? WORLD.roadXs[col - 1] + half + sidewalk + WORLD.buildingInset : WORLD.buildingInset;
      const right = WORLD.roadXs[col] - half - sidewalk - WORLD.buildingInset;
      const top = row ? WORLD.roadYs[row - 1] + half + sidewalk + WORLD.buildingInset : WORLD.buildingInset;
      const bottom = WORLD.roadYs[row] - half - sidewalk - WORLD.buildingInset;
      const width = (right - left) * range(rng, 0.68, 0.92);
      const height = (bottom - top) * range(rng, 0.65, 0.9);
      const index = row * WORLD.roadXs.length + col;
      world.buildings.push({ id: `building-${index}`, name: names[index],
        ...rect(range(rng, left + width / 2, right - width / 2),
          range(rng, top + height / 2, bottom - height / 2), width, height),
        color: pick(rng, PALETTE.roofs), roofStyle: int(rng, 0, 3) });
    }
  }
  world.solids = world.buildings.slice();

  // Four corner waypoints per junction form a directed circulation ring.
  // External links stay on the right-hand lane, including opposite routes.
  const offset = WORLD.laneOffset;
  const corners = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
  const id = (col, row, corner) => `lane-${col}-${row}-${corner}`;
  for (let row = 0; row < WORLD.roadYs.length; row++) {
    for (let col = 0; col < WORLD.roadXs.length; col++) {
      corners.forEach(([sx, sy], corner) => {
        const links = [id(col, row, (corner + 1) % 4)];
        if (corner === 0 && row + 1 < WORLD.roadYs.length) links.push(id(col, row + 1, 3));
        if (corner === 1 && col + 1 < WORLD.roadXs.length) links.push(id(col + 1, row, 0));
        if (corner === 2 && row > 0) links.push(id(col, row - 1, 1));
        if (corner === 3 && col > 0) links.push(id(col - 1, row, 2));
        world.roadNodes.push({ id: id(col, row, corner), x: WORLD.roadXs[col] + sx * offset,
          y: WORLD.roadYs[row] + sy * offset, links });
      });
    }
  }
  // Extend the eastern junction's two lanes to a turnaround at the dock trigger.
  const dockRow = WORLD.roadYs.indexOf(MISSION.docks.y);
  const eastCol = WORLD.roadXs.length - 1;
  const junction = world.roadNodes.find(n => n.id === id(eastCol, dockRow, 1));
  junction.links.push('dock-east');
  world.roadNodes.push({ id: 'dock-east', x: MISSION.docks.x, y: MISSION.docks.y + offset, links: ['dock-west'] },
    { id: 'dock-west', x: MISSION.docks.x, y: MISSION.docks.y - offset, links: [id(eastCol, dockRow, 2)] });

  for (let i = 0; i < 90; i++) {
    const coastal = i < 48;
    const x = coastal ? range(rng, WORLD.beachX + 24, WORLD.waterX - 28) : range(rng, 35, WORLD.beachX - 35);
    const y = range(rng, 35, WORLD.height - 35);
    if (world.roads.some(r => overlaps(edges(rect(x, y, 42, 42)), edges(r))) ||
        isSolid(world, rect(x, y, 42, 42))) continue;
    world.palms.push({ id: `palm-${i}`, x, y, scale: range(rng, 0.75, 1.3), angle: range(rng, 0, Math.PI * 2) });
  }
  return world;
}

// Test whether an entire rectangular water intersection is covered by the union
// of docks. Merely touching one pier is insufficient for a wide vehicle.
function uncoveredWater(world, bounds) {
  const water = edges(world.water);
  if (!overlaps(bounds, water)) return false;
  const area = { left: Math.max(bounds.left, water.left), right: Math.min(bounds.right, water.right),
    top: Math.max(bounds.top, water.top), bottom: Math.min(bounds.bottom, water.bottom) };
  const docks = world.docks.map(edges).filter(d => overlaps(area, d));
  const cuts = [area.left, area.right];
  for (const d of docks) cuts.push(Math.max(area.left, d.left), Math.min(area.right, d.right));
  cuts.sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i] <= cuts[i - 1]) continue;
    const x = (cuts[i] + cuts[i - 1]) / 2;
    const spans = docks.filter(d => d.left <= x && d.right >= x).sort((a, b) => a.top - b.top);
    let covered = area.top;
    for (const d of spans) {
      if (d.top > covered) break;
      covered = Math.max(covered, d.bottom);
    }
    if (covered < area.bottom) return true;
  }
  return false;
}

export function isSolid(world, bounds) {
  const b = edges(bounds);
  return b.left < 0 || b.top < 0 || b.right > world.width || b.bottom > world.height ||
    world.solids.some(s => overlaps(b, edges(s))) || uncoveredWater(world, b);
}

function bodyBounds(body) {
  const c = Math.abs(Math.cos(body.angle || 0));
  const s = Math.abs(Math.sin(body.angle || 0));
  return rect(body.x, body.y, body.width * c + body.height * s, body.width * s + body.height * c);
}

/** Substep both axes; binary refinement stops flush against each obstruction. */
export function moveWithCollisions(world, body, dx, dy) {
  const result = { hitX: false, hitY: false };
  const bounds = bodyBounds(body);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 4));
  for (let step = 0; step < steps; step++) {
    for (const [axis, delta, hit] of [['x', dx / steps, 'hitX'], ['y', dy / steps, 'hitY']]) {
      if (!delta || result[hit]) continue;
      const start = body[axis];
      bounds.x = body.x;
      bounds.y = body.y;
      bounds[axis] = start + delta;
      if (!isSolid(world, bounds)) { body[axis] += delta; continue; }
      result[hit] = true;
      let low = 0, high = 1;
      for (let i = 0; i < 24; i++) {
        const fraction = (low + high) / 2;
        bounds[axis] = start + delta * fraction;
        if (isSolid(world, bounds)) high = fraction;
        else low = fraction;
      }
      body[axis] = start + delta * low;
    }
  }
  body.x = Math.max(bounds.width / 2, Math.min(world.width - bounds.width / 2, body.x));
  body.y = Math.max(bounds.height / 2, Math.min(world.height - bounds.height / 2, body.y));
  return result;
}

export function findFreePosition(world, desired, width, height) {
  const offsets = [];
  const spacing = Math.max(8, Math.min(width, height) / 2);
  for (let y = -16; y <= 16; y++) for (let x = -16; x <= 16; x++) offsets.push({ x, y });
  offsets.sort((a, b) => (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y) || a.y - b.y || a.x - b.x);
  for (const offset of offsets) {
    const p = { x: desired.x + offset.x * spacing, y: desired.y + offset.y * spacing };
    if (!isSolid(world, { ...p, width, height })) return p;
  }
  return null;
}

export function nearestRoadNode(world, point) {
  let nearest = null, distance = Infinity;
  for (const node of world.roadNodes) {
    const squared = (node.x - point.x) ** 2 + (node.y - point.y) ** 2;
    if (squared < distance) { nearest = node.id; distance = squared; }
  }
  return nearest;
}

function segmentInterval(from, to, bounds) {
  const b = edges(bounds);
  let low = 0, high = 1;
  for (const [axis, min, max] of [['x', b.left, b.right], ['y', b.top, b.bottom]]) {
    const delta = to[axis] - from[axis];
    if (delta === 0) { if (from[axis] < min || from[axis] > max) return null; }
    else {
      const a = (min - from[axis]) / delta, z = (max - from[axis]) / delta;
      low = Math.max(low, Math.min(a, z));
      high = Math.min(high, Math.max(a, z));
      if (low > high) return null;
    }
  }
  return [low, high];
}

export function hasLineOfSight(world, from, to) {
  for (const p of [from, to]) if (p.x < 0 || p.y < 0 || p.x > world.width || p.y > world.height) return false;
  if (world.solids.some(s => segmentInterval(from, to, s))) return false;
  const water = segmentInterval(from, to, world.water);
  if (!water) return true;
  const spans = world.docks.map(d => segmentInterval(from, to, d)).filter(Boolean).sort((a, b) => a[0] - b[0]);
  let covered = water[0];
  for (const [start, end] of spans) {
    if (start > covered) break;
    covered = Math.max(covered, end);
  }
  return covered >= water[1];
}
