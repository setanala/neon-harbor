import { COMBAT, PALETTE, PEDESTRIAN, PLAYER, TRAFFIC, VEHICLE, WANTED, WORLD } from './config.js';
import { findFreePosition, hasLineOfSight, isSolid, moveWithCollisions, nearestRoadNode } from './world.js';
import { pick } from './random.js';

const TAU = Math.PI * 2;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const distance2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const angleTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const turn = (from, to, amount) => {
  let d = (to - from + Math.PI) % TAU;
  if (d < 0) d += TAU;
  return from + (d - Math.PI) * amount;
};
const point = (x, y) => ({ x, y });
const body = (id, x, y, width, height, angle = 0) => ({ id, x, y, width, height, angle, vx: 0, vy: 0 });
const emit = (state, type, name, data = {}) => state.events.push({ type, name, ...data });

function nodeMap(world) { return new Map(world.roadNodes.map(node => [node.id, node])); }

function roadPosition(world, rng) {
  const node = pick(rng, world.roadNodes);
  const links = node.links.map(id => world.roadNodes.find(item => item.id === id)).filter(Boolean);
  const next = pick(rng, links.length ? links : [node]);
  const dx = next.x - node.x, dy = next.y - node.y;
  return { x: node.x, y: node.y, angle: Math.atan2(dy, dx), node: node.id, next: next.id };
}

function sidewalkPosition(world, rng) {
  const side = pick(rng, world.sidewalks);
  const horizontal = side.width > side.height;
  return horizontal
    ? { x: side.x + (rng() - 0.5) * side.width, y: side.y + (rng() - 0.5) * Math.max(0, side.height - PEDESTRIAN.height) }
    : { x: side.x + (rng() - 0.5) * Math.max(0, side.width - PEDESTRIAN.width), y: side.y + (rng() - 0.5) * side.height };
}

function createCar(state, id, kind, x, y, angle, nodeId, nextNodeId, color) {
  return { ...body(id, x, y, VEHICLE.width, VEHICLE.height, angle), kind, color,
    health: VEHICLE.maxHealth, speed: kind === 'traffic' ? TRAFFIC.speed : 0,
    driver: kind === 'traffic' ? 'ai' : null, roadNodeId: nodeId, nextNodeId,
    turnAtNodeId: null, collisionCooldown: 0, ramCooldown: 0, respawnIn: 0,
    stolen: false, destroyed: false };
}

export function createEntities(world, rng) {
  const streams = typeof rng === 'function' ? { traffic: rng, pedestrians: rng } : rng;
  const trafficRng = streams?.traffic || streams?.world || (() => 0.5);
  const pedestrianRng = streams?.pedestrians || streams?.world || trafficRng;
  const player = { ...body('player', WORLD.spawn.x, WORLD.spawn.y, PLAYER.width, PLAYER.height),
    health: PLAYER.maxHealth, vehicleId: null, aimAngle: 0, fireCooldown: 0, invulnerableFor: 0 };
  const cars = [];
  const occupied = [];
  for (let i = 0; i < TRAFFIC.count; i++) {
    let spot = roadPosition(world, trafficRng);
    let attempts = 0;
    while (attempts++ < 24 && (distance2(spot, player) < 170 ** 2 || occupied.some(p => distance2(p, spot) < 115 ** 2))) spot = roadPosition(world, trafficRng);
    occupied.push(spot);
    cars.push(createCar({ nextEntityId: i }, `car-${i + 1}`, 'traffic', spot.x, spot.y, spot.angle, spot.node, spot.next,
      pick(trafficRng, PALETTE.cars)));
  }
  const hot = findFreePosition(world, { x: 1780, y: 1260 }, VEHICLE.width, VEHICLE.height) || { x: 1780, y: 1260 };
  cars.push(createCar(null, 'mission-hot-car', 'mission', hot.x, hot.y, 0, nearestRoadNode(world, hot), null, PALETTE.gold));
  const pedestrians = [];
  for (let i = 0; i < PEDESTRIAN.count; i++) {
    let p = sidewalkPosition(world, pedestrianRng), attempts = 0;
    while (attempts++ < 20 && (distance2(p, player) < 105 ** 2 || isSolid(world, { ...p, width: PEDESTRIAN.width, height: PEDESTRIAN.height }))) p = sidewalkPosition(world, pedestrianRng);
    const id = `ped-${i + 1}`;
    pedestrians.push({ ...body(id, p.x, p.y, PEDESTRIAN.width, PEDESTRIAN.height), health: PEDESTRIAN.health,
      mode: 'wander', target: sidewalkPosition(world, pedestrianRng), fleeFor: 0, dangerFrom: null, respawnIn: 0 });
  }
  return { player, cars, pedestrians, bullets: [] };
}

export function getControlledBody(state) {
  const player = state.entities.player;
  return player.vehicleId ? state.entities.cars.find(car => car.id === player.vehicleId && !car.destroyed) || player : player;
}

function carBounds(car) {
  const c = Math.abs(Math.cos(car.angle)), s = Math.abs(Math.sin(car.angle));
  return { x: car.x, y: car.y, width: car.width * c + car.height * s, height: car.width * s + car.height * c };
}

function nearVehicle(state, player) {
  let best = null, dBest = PLAYER.enterRadius ** 2;
  for (const car of state.entities.cars) {
    if (car.destroyed || car.kind === 'police' || car.driver === 'player') continue;
    const d = distance2(player, car);
    if (d <= dBest) { best = car; dBest = d; }
  }
  return best;
}

export function tryEnterExitVehicle(state) {
  const player = state.entities.player;
  if (player.vehicleId) {
    const car = state.entities.cars.find(item => item.id === player.vehicleId && !item.destroyed);
    if (!car) { player.vehicleId = null; return false; }
    const side = car.angle + Math.PI / 2;
    const positions = [side, side + Math.PI];
    for (const a of positions) {
      const desired = { x: car.x + Math.cos(a) * PLAYER.exitOffset, y: car.y + Math.sin(a) * PLAYER.exitOffset };
      const free = findFreePosition(state.world, desired, player.width, player.height);
      if (!free || distance2(free, car) < 25 ** 2) continue;
      player.x = free.x; player.y = free.y; player.angle = car.angle;
      player.vx = car.vx; player.vy = car.vy; player.vehicleId = null;
      car.driver = car.kind === 'mission' ? null : 'ai';
      return true;
    }
    return false;
  }
  const car = nearVehicle(state, player);
  if (!car) return false;
  const wasStolen = car.kind === 'traffic' && !car.stolen;
  car.driver = 'player';
  player.vehicleId = car.id;
  player.x = car.x; player.y = car.y; player.angle = car.angle;
  if (wasStolen) {
    car.stolen = true;
    addHeat(state, VEHICLE.theftHeat, 'vehicle-theft');
    emit(state, 'crime', 'vehicle-theft', { sourceId: player.id, targetId: car.id, amount: VEHICLE.theftHeat });
  }
  return true;
}

export function addHeat(state, amount, source) {
  const wanted = state.wanted;
  wanted.heat = clamp((Number(wanted.heat) || 0) + Math.max(0, Number(amount) || 0), 0, WANTED.maxHeat);
  wanted.unseenFor = 0;
  emit(state, 'crime', source, { amount: Math.max(0, Number(amount) || 0), sourceId: state.entities.player.id });
  wanted.stars = starCount(wanted.heat);
}

function starCount(heat) {
  let stars = 0;
  for (let i = 1; i < WANTED.thresholds.length; i++) if (heat >= WANTED.thresholds[i]) stars = i;
  return clamp(stars, 0, WANTED.maxStars);
}

function movePlayer(state, controls, dt) {
  const p = state.entities.player;
  p.fireCooldown = Math.max(0, p.fireCooldown - dt);
  p.invulnerableFor = Math.max(0, p.invulnerableFor - dt);
  if (p.vehicleId) return;
  const length = Math.hypot(controls.moveX || 0, controls.moveY || 0);
  if (length > 0) {
    const speed = controls.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    p.vx = (controls.moveX / length) * speed;
    p.vy = (controls.moveY / length) * speed;
    p.angle = Math.atan2(p.vy, p.vx);
  } else {
    p.vx *= Math.max(0, 1 - 9 * dt); p.vy *= Math.max(0, 1 - 9 * dt);
  }
  const collision = moveWithCollisions(state.world, p, p.vx * dt, p.vy * dt);
  if (collision.hitX) p.vx = 0;
  if (collision.hitY) p.vy = 0;
}

function updatePlayerCar(state, controls, dt) {
  const p = state.entities.player;
  if (!p.vehicleId) return;
  const car = state.entities.cars.find(item => item.id === p.vehicleId && !item.destroyed);
  if (!car) { p.vehicleId = null; return; }
  const forward = (controls.moveY < 0 ? 1 : 0) - (controls.moveY > 0 ? 1 : 0);
  if (forward > 0) car.speed += VEHICLE.acceleration * dt;
  else if (forward < 0) {
    if (car.speed > 12) car.speed = Math.max(0, car.speed - VEHICLE.brake * dt);
    else car.speed = Math.max(-VEHICLE.reverseSpeed, car.speed - VEHICLE.acceleration * 0.55 * dt);
  } else car.speed *= Math.max(0, 1 - VEHICLE.drag * dt / Math.max(1, Math.abs(car.speed)));
  car.speed = clamp(car.speed, -VEHICLE.reverseSpeed, VEHICLE.maxSpeed);
  const steering = clamp(Math.abs(car.speed) / Math.max(VEHICLE.steeringMinSpeed, 80), 0.15, 1);
  car.angle += (controls.moveX || 0) * VEHICLE.steering * steering * dt * (car.speed < -1 ? -1 : 1);
  car.vx = Math.cos(car.angle) * car.speed; car.vy = Math.sin(car.angle) * car.speed;
  const oldX = car.x, oldY = car.y;
  const collision = moveWithCollisions(state.world, car, car.vx * dt, car.vy * dt);
  if (collision.hitX || collision.hitY) {
    car.speed *= -0.22;
    if (car.collisionCooldown <= 0 && Math.abs(car.speed) > VEHICLE.impactMinSpeed * 0.25) {
      damageEntity(state, car.id, VEHICLE.collisionDamage, p.id);
      car.collisionCooldown = VEHICLE.collisionCooldown;
      emit(state, 'sound', 'impact', { targetId: car.id });
      emit(state, 'damage', 'vehicle-impact', { sourceId: p.id, targetId: car.id, amount: VEHICLE.collisionDamage });
    }
    car.vx = car.x === oldX ? 0 : car.vx; car.vy = car.y === oldY ? 0 : car.vy;
  }
  p.x = car.x; p.y = car.y; p.angle = car.angle; p.vx = car.vx; p.vy = car.vy;
}

function routeTraffic(car, state, nodes) {
  const next = nodes.get(car.nextNodeId);
  if (!next) {
    car.roadNodeId = nearestRoadNode(state.world, car);
    const node = nodes.get(car.roadNodeId);
    car.nextNodeId = node?.links[0] || null;
    return;
  }
  if (distance2(car, next) < TRAFFIC.junctionRadius ** 2) {
    car.roadNodeId = next.id;
    const options = next.links.map(id => nodes.get(id)).filter(Boolean);
    let chosen = options[0];
    if (options.length > 1 && state.rng?.traffic && state.rng.traffic() < TRAFFIC.turnChance) chosen = pick(state.rng.traffic, options);
    car.nextNodeId = chosen?.id || null;
  }
  const target = nodes.get(car.nextNodeId);
  if (target) car.angle = turn(car.angle, angleTo(car, target), Math.min(1, 3.2 * state._stepDt));
}

function updateTraffic(state, dt) {
  const nodes = nodeMap(state.world);
  for (const car of state.entities.cars) {
    if (car.destroyed || car.kind !== 'traffic' || car.driver !== 'ai') continue;
    car.collisionCooldown = Math.max(0, car.collisionCooldown - dt);
    routeTraffic(car, state, nodes);
    let targetSpeed = TRAFFIC.speed;
    for (const other of state.entities.cars) {
      if (other === car || other.destroyed) continue;
      const ahead = Math.cos(car.angle) * (other.x - car.x) + Math.sin(car.angle) * (other.y - car.y);
      const lateral = Math.abs(-Math.sin(car.angle) * (other.x - car.x) + Math.cos(car.angle) * (other.y - car.y));
      if (ahead > 0 && ahead < 76 && lateral < 28) targetSpeed = 0;
    }
    car.speed += clamp(targetSpeed - car.speed, -VEHICLE.brake * dt, VEHICLE.acceleration * dt);
    car.vx = Math.cos(car.angle) * car.speed; car.vy = Math.sin(car.angle) * car.speed;
    const result = moveWithCollisions(state.world, car, car.vx * dt, car.vy * dt);
    if (result.hitX || result.hitY) { car.speed = 0; car.vx = 0; car.vy = 0; }
  }
}

function fleePed(ped, from) {
  ped.mode = 'flee'; ped.fleeFor = PEDESTRIAN.fleeSeconds; ped.dangerFrom = point(from.x, from.y);
  const a = angleTo(from, ped) + (ped.id.charCodeAt(ped.id.length - 1) % 2 ? 0.22 : -0.22);
  ped.target = point(ped.x + Math.cos(a) * 260, ped.y + Math.sin(a) * 260);
}

function updatePedestrians(state, dt) {
  const player = getControlledBody(state);
  for (const ped of state.entities.pedestrians) {
    if (ped.mode === 'down') {
      ped.respawnIn -= dt;
      if (ped.respawnIn <= 0) {
        const p = sidewalkPosition(state.world, state.rng?.pedestrians || (() => 0.5));
        ped.x = p.x; ped.y = p.y; ped.health = PEDESTRIAN.health; ped.mode = 'wander'; ped.target = sidewalkPosition(state.world, state.rng?.pedestrians || (() => 0.5));
      }
      continue;
    }
    ped.fleeFor = Math.max(0, ped.fleeFor - dt);
    if (ped.mode === 'flee' && ped.fleeFor === 0) { ped.mode = 'wander'; ped.dangerFrom = null; ped.target = sidewalkPosition(state.world, state.rng?.pedestrians || (() => 0.5)); }
    let threat = null, threatD = PEDESTRIAN.dangerRadius ** 2;
    if (distance2(ped, player) < threatD && (state.wanted.stars > 0 || player.vehicleId)) { threat = player; threatD = distance2(ped, player); }
    for (const bullet of state.entities.bullets) if (distance2(ped, bullet) < threatD) { threat = bullet; threatD = distance2(ped, bullet); }
    if (threat && ped.mode !== 'flee') fleePed(ped, threat);
    const speed = ped.mode === 'flee' ? PEDESTRIAN.fleeSpeed : PEDESTRIAN.speed;
    const d = Math.sqrt(distance2(ped, ped.target));
    if (d < 10 && ped.mode === 'wander') ped.target = sidewalkPosition(state.world, state.rng?.pedestrians || (() => 0.5));
    else if (d > 0) {
      ped.angle = angleTo(ped, ped.target); ped.vx = Math.cos(ped.angle) * speed; ped.vy = Math.sin(ped.angle) * speed;
      const hit = moveWithCollisions(state.world, ped, ped.vx * dt, ped.vy * dt);
      if (hit.hitX || hit.hitY) { ped.vx = 0; ped.vy = 0; if (ped.mode === 'wander') ped.target = sidewalkPosition(state.world, state.rng?.pedestrians || (() => 0.5)); }
    }
    const driver = player.vehicleId ? state.entities.cars.find(c => c.id === player.vehicleId) : null;
    if (driver && Math.abs(driver.speed) > VEHICLE.impactMinSpeed && distance2(ped, driver) < 35 ** 2) {
      damageEntity(state, ped.id, VEHICLE.pedestrianDamage, driver.id);
      fleePed(ped, driver);
      addHeat(state, COMBAT.assaultHeat, 'pedestrian-strike');
    }
  }
}

function segmentRect(from, to, rect, radius = 0) {
  const left = rect.x - rect.width / 2 - radius, right = rect.x + rect.width / 2 + radius;
  const top = rect.y - rect.height / 2 - radius, bottom = rect.y + rect.height / 2 + radius;
  let lo = 0, hi = 1;
  for (const [origin, delta, min, max] of [[from.x, to.x - from.x, left, right], [from.y, to.y - from.y, top, bottom]]) {
    if (Math.abs(delta) < 1e-9) { if (origin < min || origin > max) return null; continue; }
    const a = (min - origin) / delta, b = (max - origin) / delta;
    lo = Math.max(lo, Math.min(a, b)); hi = Math.min(hi, Math.max(a, b));
    if (lo > hi) return null;
  }
  return lo;
}

function fireOnce(state, aim) {
  const player = state.entities.player;
  if (player.vehicleId || player.fireCooldown > 0 || state.entities.bullets.length >= COMBAT.maxBullets) return false;
  const origin = { x: player.x + Math.cos(player.aimAngle) * 16, y: player.y + Math.sin(player.aimAngle) * 16 };
  let dx = aim.x - player.x, dy = aim.y - player.y;
  if (Math.hypot(dx, dy) < 1) { dx = Math.cos(player.aimAngle); dy = Math.sin(player.aimAngle); }
  const length = Math.hypot(dx, dy); dx /= length; dy /= length;
  const bullet = { id: `bullet-${state.nextEntityId++}`, ownerId: player.id, x: origin.x, y: origin.y,
    previousX: origin.x, previousY: origin.y, vx: dx * COMBAT.bulletSpeed, vy: dy * COMBAT.bulletSpeed,
    life: COMBAT.bulletLifetime, damage: COMBAT.bulletDamage };
  state.entities.bullets.push(bullet); player.fireCooldown = COMBAT.fireInterval;
  emit(state, 'sound', 'shot', { sourceId: player.id }); emit(state, 'crime', 'gunshot', { sourceId: player.id, amount: COMBAT.gunshotHeat });
  addHeat(state, COMBAT.gunshotHeat, 'gunshot');
  return true;
}

export function firePistol(state, aim) {
  const p = state.entities.player;
  p.aimAngle = angleTo(p, aim);
  return fireOnce(state, aim);
}

function updateBullets(state, dt) {
  const keep = [];
  for (const bullet of state.entities.bullets) {
    bullet.previousX = bullet.x; bullet.previousY = bullet.y;
    const end = { x: bullet.x + bullet.vx * dt, y: bullet.y + bullet.vy * dt };
    let nearest = null, first = Infinity;
    for (const solid of state.world.solids) {
      const t = segmentRect(bullet, end, solid, COMBAT.bulletRadius);
      if (t !== null && t < first) { first = t; nearest = null; }
    }
    for (const car of state.entities.cars) {
      if (car.destroyed || car.id === bullet.ownerId) continue;
      const t = segmentRect(bullet, end, carBounds(car), COMBAT.bulletRadius);
      if (t !== null && t < first) { first = t; nearest = car; }
    }
    for (const ped of state.entities.pedestrians) {
      if (ped.mode === 'down') continue;
      const t = segmentRect(bullet, end, ped, COMBAT.bulletRadius);
      if (t !== null && t < first) { first = t; nearest = ped; }
    }
    const player = state.entities.player;
    if (player.id !== bullet.ownerId) {
      const t = segmentRect(bullet, end, player, COMBAT.bulletRadius);
      if (t !== null && t < first) { first = t; nearest = player; }
    }
    if (first < Infinity) {
      bullet.x = bullet.previousX + (end.x - bullet.previousX) * first;
      bullet.y = bullet.previousY + (end.y - bullet.previousY) * first;
      if (nearest) {
        damageEntity(state, nearest.id, bullet.damage, bullet.ownerId);
        emit(state, 'damage', 'bullet-hit', { sourceId: bullet.ownerId, targetId: nearest.id, amount: bullet.damage });
        emit(state, 'sound', 'impact', { targetId: nearest.id });
        const target = nearest;
        if (target.id.startsWith('ped-') && target.mode !== 'down') fleePed(target, bullet);
        if (target.id !== player.id) addHeat(state, COMBAT.assaultHeat, 'assault');
      }
      continue;
    }
    bullet.x = end.x; bullet.y = end.y; bullet.life -= dt;
    if (bullet.life > 0 && bullet.x >= 0 && bullet.y >= 0 && bullet.x <= state.world.width && bullet.y <= state.world.height) keep.push(bullet);
  }
  state.entities.bullets = keep;
}

export function damageEntity(state, targetId, amount, sourceId = null) {
  const target = [state.entities.player, ...state.entities.cars, ...state.entities.pedestrians].find(item => item.id === targetId);
  if (!target || target.destroyed || target.mode === 'down' || amount <= 0) return;
  if (target === state.entities.player && target.invulnerableFor > 0 && sourceId !== 'environment') return;
  target.health = Math.max(0, target.health - amount);
  if (target === state.entities.player) target.invulnerableFor = PLAYER.invulnerableSeconds;
  if (target.kind) {
    target.speed *= 0.72;
    if (target.health === 0) {
      target.destroyed = true; target.driver = null; target.respawnIn = TRAFFIC.respawnSeconds;
      if (state.entities.player.vehicleId === target.id) {
        const p = state.entities.player, exit = findFreePosition(state.world, { x: target.x + Math.cos(target.angle + Math.PI / 2) * PLAYER.exitOffset, y: target.y + Math.sin(target.angle + Math.PI / 2) * PLAYER.exitOffset }, p.width, p.height);
        if (exit) { p.x = exit.x; p.y = exit.y; } else { p.x = WORLD.spawn.x; p.y = WORLD.spawn.y; }
        p.vehicleId = null; p.health = Math.max(0, p.health - 20);
      }
    }
  }
  if (target.health === 0 && target.mode) { target.mode = 'down'; target.respawnIn = 8; target.vx = 0; target.vy = 0; }
  emit(state, 'damage', 'entity-damaged', { sourceId, targetId, amount });
}

function spawnPolice(state, rng, controlled) {
  const angle = rng() * TAU;
  const radius = WANTED.spawnMinRadius + rng() * (WANTED.spawnMaxRadius - WANTED.spawnMinRadius);
  const desired = { x: clamp(controlled.x + Math.cos(angle) * radius, 50, state.world.width - 50), y: clamp(controlled.y + Math.sin(angle) * radius, 50, state.world.height - 50) };
  const nodeId = nearestRoadNode(state.world, desired);
  const node = state.world.roadNodes.find(n => n.id === nodeId);
  if (!node) return null;
  const free = findFreePosition(state.world, node, VEHICLE.width, VEHICLE.height);
  if (!free) return null;
  const id = `police-${state.nextEntityId++}`;
  const options = node.links.map(link => state.world.roadNodes.find(n => n.id === link)).filter(Boolean);
  const next = options.sort((a, b) => distance2(a, controlled) - distance2(b, controlled))[0];
  const car = createCar(state, id, 'police', free.x, free.y, next ? angleTo(free, next) : 0, node.id, next?.id || null, PALETTE.police);
  car.speed = WANTED.policeSpeed; car.driver = 'ai';
  state.entities.cars.push(car);
  return car;
}

function updatePolice(state, dt) {
  const wanted = state.wanted;
  const controlled = getControlledBody(state);
  const policeRng = state.rng?.police || (() => 0.5);
  let cops = state.entities.cars.filter(car => car.kind === 'police' && !car.destroyed);
  const desiredCount = WANTED.policeCounts[wanted.stars] || 0;
  while (cops.length < desiredCount) {
    const cop = spawnPolice(state, policeRng, controlled);
    if (!cop) break;
    cops.push(cop);
  }
  if (cops.length > desiredCount && wanted.stars === 0) {
    for (const cop of cops.slice(desiredCount)) cop.destroyed = true;
    cops = cops.slice(0, desiredCount);
  }
  let sight = false;
  for (const cop of cops) {
    cop.ramCooldown = Math.max(0, cop.ramCooldown - dt);
    const d2 = distance2(cop, controlled);
    if (d2 <= WANTED.sightRadius ** 2 && hasLineOfSight(state.world, cop, controlled)) sight = true;
    const targetAngle = angleTo(cop, controlled);
    cop.angle = turn(cop.angle, targetAngle, Math.min(1, 2.4 * dt));
    const speed = WANTED.policeSpeed + wanted.stars * WANTED.speedPerStar;
    cop.speed = speed; cop.vx = Math.cos(cop.angle) * speed; cop.vy = Math.sin(cop.angle) * speed;
    const hit = moveWithCollisions(state.world, cop, cop.vx * dt, cop.vy * dt);
    if (hit.hitX || hit.hitY) cop.angle += 0.72;
    if (d2 < 48 ** 2 && cop.ramCooldown <= 0) {
      damageEntity(state, controlled.id, WANTED.ramDamage, cop.id);
      if (controlled.id !== state.entities.player.id && controlled.health > 0) damageEntity(state, controlled.id, WANTED.ramDamage, cop.id);
      cop.ramCooldown = WANTED.ramCooldown;
      emit(state, 'sound', 'impact', { sourceId: cop.id, targetId: controlled.id });
      emit(state, 'damage', 'police-ram', { sourceId: cop.id, targetId: controlled.id, amount: WANTED.ramDamage });
    }
  }
  wanted.seenThisStep = sight;
  if (sight) wanted.unseenFor = 0; else wanted.unseenFor += dt;
  if (wanted.unseenFor >= WANTED.loseSightSeconds && wanted.heat > 0) {
    wanted.heat = Math.max(0, wanted.heat - WANTED.decayPerSecond * dt);
    wanted.stars = starCount(wanted.heat);
  }
  if (wanted.stars > 0 && cops.some(cop => distance2(cop, controlled) <= WANTED.arrestRadius ** 2) && Math.hypot(controlled.vx, controlled.vy) <= WANTED.arrestSpeed) wanted.arrestFor += dt;
  else wanted.arrestFor = 0;
  if (state.entities.player.health <= 0) {
    if (state.screen !== 'wasted') { state.screen = 'wasted'; emit(state, 'terminal', 'wasted', { text: 'You were killed.' }); emit(state, 'sound', 'wasted'); }
  } else if (wanted.arrestFor >= WANTED.arrestSeconds && state.screen !== 'busted') {
    state.screen = 'busted'; emit(state, 'terminal', 'busted', { text: 'The police caught you.' }); emit(state, 'sound', 'busted');
  }
}

function dynamicCollisions(state) {
  const cars = state.entities.cars.filter(c => !c.destroyed);
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) >= (a.width + b.width) / 2 || Math.abs(dy) >= (a.height + b.height) / 2) continue;
    const impact = Math.abs(a.speed - b.speed);
    if (impact < VEHICLE.impactMinSpeed || (a.collisionCooldown > 0 && b.collisionCooldown > 0)) continue;
    const source = a.driver === 'player' ? state.entities.player.id : b.driver === 'player' ? state.entities.player.id : null;
    damageEntity(state, a.id, VEHICLE.collisionDamage, source);
    damageEntity(state, b.id, VEHICLE.collisionDamage, source);
    a.collisionCooldown = b.collisionCooldown = VEHICLE.collisionCooldown;
    a.speed *= 0.55; b.speed *= 0.55;
    if (source) { addHeat(state, COMBAT.assaultHeat, 'vehicle-collision'); emit(state, 'sound', 'impact'); }
  }
}

function respawnTraffic(state) {
  for (const car of state.entities.cars) {
    if (!car.destroyed || car.kind !== 'traffic') continue;
    car.respawnIn -= state._stepDt;
    if (car.respawnIn > 0) continue;
    const p = roadPosition(state.world, state.rng?.traffic || (() => 0.5));
    if (distance2(p, getControlledBody(state)) < 330 ** 2) { car.respawnIn = 2; continue; }
    Object.assign(car, createCar(null, car.id, 'traffic', p.x, p.y, p.angle, p.node, p.next, pick(state.rng?.traffic || (() => 0.5), PALETTE.cars)));
  }
}

export function updateEntities(state, controls, dt) {
  if (!state || !state.entities || dt <= 0) return;
  state._stepDt = dt;
  if (state.screen !== 'play') { delete state._stepDt; return; }
  if (controls.interact) tryEnterExitVehicle(state);
  for (const car of state.entities.cars) {
    car.collisionCooldown = Math.max(0, car.collisionCooldown - dt);
    car.ramCooldown = Math.max(0, car.ramCooldown - dt);
  }
  movePlayer(state, controls, dt);
  updatePlayerCar(state, controls, dt);
  updateTraffic(state, dt);
  updatePedestrians(state, dt);
  if (controls.fire && !state.entities.player.vehicleId) {
    state.entities.player.aimAngle = angleTo(state.entities.player, controls.aim);
    fireOnce(state, controls.aim);
  }
  updateBullets(state, dt);
  dynamicCollisions(state);
  respawnTraffic(state);
  updatePolice(state, dt);
  delete state._stepDt;
}
