import { MISSION, PALETTE, VEHICLE, WANTED } from './config.js';
import { addHeat, getControlledBody } from './entities.js';
import { findFreePosition, nearestRoadNode } from './world.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distanceSquared = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const missionIdFor = (progress) => progress.chainIndex < 4
  ? progress.chainIndex
  : progress.repeatIndex;

export function createMissionCatalog() {
  return [
    {
      id: 'delivery',
      title: 'Neon Express',
      briefing: 'Vince Marlowe: A parcel is waiting on the north side. Grab it at the old intersection, then get it across town to the marina before the clock runs dry.',
      contactName: MISSION.contactName,
      timeLimit: MISSION.timeLimits[0],
      baseReward: MISSION.rewards[0],
      initialHeat: 0,
      objectives: [
        { id: 'pickup', type: 'reach', point: { ...MISSION.pickup }, radius: MISSION.markerRadius,
          label: 'Pick up Vince’s parcel', requiredVehicle: 'any' },
        { id: 'delivery', type: 'reach', point: { ...MISSION.delivery }, radius: MISSION.markerRadius,
          label: 'Deliver the parcel at the marina', requiredVehicle: 'any' },
      ],
    },
    {
      id: 'packages',
      title: 'Three Loose Ends',
      briefing: 'Vince Marlowe: Three packages got scattered around the city. Collect every one, then bring them back to me in Palm Vice.',
      contactName: MISSION.contactName,
      timeLimit: MISSION.timeLimits[1],
      baseReward: MISSION.rewards[1],
      initialHeat: 0,
      objectives: [
        { id: 'packages', type: 'collect', points: MISSION.packages.map(point => ({ ...point })),
          radius: MISSION.markerRadius, label: 'Collect all three packages' },
        { id: 'return', type: 'reach', point: { ...MISSION.contact }, radius: MISSION.interactionRadius,
          label: 'Return all three packages to Vince', requiredVehicle: 'any' },
      ],
    },
    {
      id: 'escape',
      title: 'Heat Sink',
      briefing: 'Vince Marlowe: I put a three-star tail on your name. Lose the cops, clear every wanted star, and make it to the hideout on the south side.',
      contactName: MISSION.contactName,
      timeLimit: MISSION.timeLimits[2],
      baseReward: MISSION.rewards[2],
      initialHeat: 100,
      objectives: [
        { id: 'hideout', type: 'escape', point: { ...MISSION.hideout }, radius: MISSION.markerRadius,
          requiredStars: 0, label: 'Lose the cops, then reach the hideout' },
      ],
    },
    {
      id: 'hot-car',
      title: 'Dockside Transfer',
      briefing: 'Vince Marlowe: There’s a hot car at the crossroads. Take that exact ride to the docks and keep it rolling until the harbor crew takes over.',
      contactName: MISSION.contactName,
      timeLimit: MISSION.timeLimits[3],
      baseReward: MISSION.rewards[3],
      initialHeat: 0,
      objectives: [
        { id: 'steal-car', type: 'steal', point: { ...MISSION.hotCar }, radius: MISSION.markerRadius,
          label: 'Enter Vince’s hot car' },
        { id: 'deliver-car', type: 'reach', point: { ...MISSION.docks }, radius: MISSION.markerRadius,
          label: 'Deliver the hot car to the docks (keep it moving slowly)', requiredVehicle: 'target' },
      ],
    },
  ];
}

export function createMissionProgress() {
  return {
    chainIndex: 0,
    repeatRound: 0,
    repeatIndex: 0,
    active: null,
    completedCount: 0,
    lastResult: null,
  };
}

function notify(state, text, tone = 'info') {
  if (!Array.isArray(state.notices)) state.notices = [];
  state.notices.push({ text, remaining: MISSION.messageSeconds, tone });
  if (state.notices.length > 8) state.notices.splice(0, state.notices.length - 8);
}

function emit(state, type, name, data = {}) {
  if (Array.isArray(state.events)) state.events.push({ type, name, ...data });
}

function definitionFor(state, id) {
  return createMissionCatalog().find(definition => definition.id === id) || null;
}

function currentDefinition(state) {
  const progress = state.missions;
  const index = missionIdFor(progress);
  return createMissionCatalog()[index] || null;
}

function starCount(heat) {
  let stars = 0;
  for (let i = 1; i < WANTED.thresholds.length; i++) {
    if (heat >= WANTED.thresholds[i]) stars = i;
  }
  return clamp(stars, 0, WANTED.maxStars);
}

function bodyAabb(body) {
  const angle = body.angle || 0;
  const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  const width = body.width * cos + body.height * sin;
  const height = body.width * sin + body.height * cos;
  return { left: body.x - width / 2, right: body.x + width / 2,
    top: body.y - height / 2, bottom: body.y + height / 2 };
}

function overlapsWithMargin(a, b, margin = 8) {
  const one = bodyAabb(a), two = bodyAabb(b);
  return one.left < two.right + margin && one.right + margin > two.left &&
    one.top < two.bottom + margin && one.bottom + margin > two.top;
}

function missionCarPosition(state) {
  const world = state.world;
  const offsets = [{ x: 0, y: 0 }];
  for (let radius = 12; radius <= MISSION.markerRadius - 4; radius += 12) {
    for (let step = 0; step < 16; step++) {
      const angle = step * Math.PI / 8;
      offsets.push({ x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius) });
    }
  }
  const blockers = [state.entities.player,
    ...state.entities.cars.filter(car => car.kind !== 'mission' && !car.destroyed),
    ...state.entities.pedestrians.filter(ped => ped.mode !== 'down')];
  for (const offset of offsets) {
    const desired = { x: MISSION.hotCar.x + offset.x, y: MISSION.hotCar.y + offset.y };
    const free = findFreePosition(world, desired, VEHICLE.width, VEHICLE.height);
    if (!free) continue;
    const candidate = { ...free, width: VEHICLE.width, height: VEHICLE.height, angle: 0 };
    if (!blockers.some(blocker => overlapsWithMargin(candidate, blocker))) return free;
  }
  return null;
}

function stageMissionCar(state) {
  const position = missionCarPosition(state);
  if (!position) return false;
  const id = 'mission-hot-car';
  const car = {
    id, x: position.x, y: position.y, width: VEHICLE.width, height: VEHICLE.height,
    angle: 0, vx: 0, vy: 0, kind: 'mission', color: PALETTE.gold,
    health: VEHICLE.maxHealth, speed: 0, driver: null,
    roadNodeId: nearestRoadNode(state.world, position), nextNodeId: null,
    turnAtNodeId: null, collisionCooldown: 0, ramCooldown: 0, respawnIn: 0,
    stolen: false, destroyed: false,
  };
  const cars = state.entities.cars;
  const oldIndex = cars.findIndex(item => item.id === id || item.kind === 'mission');
  if (oldIndex >= 0) cars.splice(oldIndex, 1, car);
  else cars.push(car);
  return true;
}

export function startMission(state) {
  if (!state || state.screen !== 'play' || !state.missions || !state.entities) return false;
  const progress = state.missions;
  if (progress.active || state.entities.player.vehicleId) return false;
  const player = state.entities.player;
  if (distanceSquared(player, MISSION.contact) > MISSION.interactionRadius ** 2) return false;
  const definition = currentDefinition(state);
  if (!definition) return false;

  if (definition.id === 'hot-car' && !stageMissionCar(state)) {
    notify(state, 'Vince: The car needs a clear spot. Step away and try again.', 'danger');
    return false;
  }
  if (definition.initialHeat > 0) {
    const wanted = state.wanted;
    wanted.heat = Math.max(wanted.heat || 0, definition.initialHeat);
    wanted.heat = clamp(wanted.heat, 0, WANTED.maxHeat);
    wanted.stars = starCount(wanted.heat);
    wanted.unseenFor = 0;
    wanted.arrestFor = 0;
  }

  const round = progress.chainIndex < 4 ? 0 : Math.max(1, progress.repeatRound);
  const multiplier = Math.min(MISSION.maxRewardMultiplier, 1 + MISSION.repeatScale * round);
  const reward = Math.round(definition.baseReward * (round ? multiplier : 1));
  const timeLimit = round
    ? Math.max(45, Math.round(definition.timeLimit / (1 + 0.1 * round)))
    : definition.timeLimit;
  progress.active = {
    definitionId: definition.id,
    objectiveIndex: 0,
    remaining: timeLimit,
    collectedIds: [],
    targetVehicleId: definition.id === 'hot-car' ? 'mission-hot-car' : null,
    reward,
    timeLimit,
  };
  progress.lastResult = null;
  notify(state, definition.briefing, 'info');
  emit(state, 'mission', 'started', { text: definition.briefing, amount: reward });
  return true;
}

function finishMission(state, definition, reason, reward) {
  const progress = state.missions;
  const wasSuccess = reason === 'completed';
  const resultReward = wasSuccess ? reward : 0;
  progress.active = null;
  progress.lastResult = { id: definition.id, success: wasSuccess, reason, reward: resultReward };
  if (!wasSuccess) {
    notify(state, `Vince Marlowe: Job failed — ${reason}`, 'danger');
    emit(state, 'mission', 'failed', { text: reason, amount: 0 });
    return;
  }

  state.cash += resultReward;
  progress.completedCount += 1;
  if (progress.chainIndex < 4) {
    progress.chainIndex += 1;
    if (progress.chainIndex === 4) {
      progress.repeatRound = 1;
      progress.repeatIndex = 0;
    }
  } else {
    progress.repeatIndex += 1;
    if (progress.repeatIndex >= 4) {
      progress.repeatRound = Math.max(1, progress.repeatRound) + 1;
      progress.repeatIndex = 0;
    }
  }
  const outros = {
    delivery: 'Vince Marlowe: Clean run. The harbor still owes you one.',
    packages: 'Vince Marlowe: All three made it back. You kept the city moving.',
    escape: 'Vince Marlowe: You shook the heat and reached the hideout. Smart work.',
    'hot-car': 'Vince Marlowe: The docks have their new ride. That’s your cut.',
  };
  notify(state, outros[definition.id], 'success');
  emit(state, 'mission', 'completed', { text: outros[definition.id], amount: resultReward });
  emit(state, 'sound', 'reward');
}

export function failMission(state, reason) {
  if (!state?.missions?.active) return;
  const definition = definitionFor(state, state.missions.active.definitionId);
  if (!definition) {
    state.missions.active = null;
    return;
  }
  finishMission(state, definition, String(reason || 'Mission failed.'), 0);
}

function objectiveProgress(state, definition, active, objective) {
  const player = state.entities.player;
  const controlled = getControlledBody(state);
  if (objective.type === 'collect') {
    let gained = 0;
    for (let i = 0; i < objective.points.length; i++) {
      const id = `${objective.id}-${i}`;
      if (active.collectedIds.includes(id) || distanceSquared(controlled, objective.points[i]) > objective.radius ** 2) continue;
      active.collectedIds.push(id);
      gained += 1;
      notify(state, `Package secured (${active.collectedIds.length}/3).`, 'success');
      emit(state, 'mission', 'package-collected', { text: id, amount: active.collectedIds.length });
    }
    if (active.collectedIds.length >= objective.points.length) {
      active.objectiveIndex += 1;
      const next = definition.objectives[active.objectiveIndex];
      if (next) notify(state, next.label, 'info');
    }
    return gained > 0;
  }
  if (objective.type === 'steal') {
    const car = state.entities.cars.find(item => item.id === active.targetVehicleId);
    if (!car || car.destroyed || player.vehicleId !== car.id || car.driver !== 'player' ||
        distanceSquared(car, objective.point) > objective.radius ** 2) return false;
    if (!car.stolen) {
      car.stolen = true;
      addHeat(state, VEHICLE.theftHeat, 'vehicle-theft');
    }
    emit(state, 'mission', 'objective', { text: 'Hot car acquired.' });
    return true;
  }
  if (objective.type === 'reach') {
    if (objective.requiredVehicle === 'foot' && player.vehicleId) return false;
    if (objective.requiredVehicle === 'target' &&
        (!active.targetVehicleId || player.vehicleId !== active.targetVehicleId)) return false;
    const body = objective.requiredVehicle === 'target' ? controlled : controlled;
    if (distanceSquared(body, objective.point) > objective.radius ** 2) return false;
    if (definition.id === 'hot-car' && objective.id === 'deliver-car') {
      const car = state.entities.cars.find(item => item.id === active.targetVehicleId);
      if (!car || car.destroyed || car.health <= 0 || Math.abs(car.speed) > 28) return false;
    }
    return true;
  }
  if (objective.type === 'escape') {
    return state.wanted.stars === objective.requiredStars &&
      distanceSquared(controlled, objective.point) <= objective.radius ** 2;
  }
  return false;
}

export function updateMissions(state, dt) {
  const active = state?.missions?.active;
  if (!active) return;
  if (state.screen === 'busted' || state.screen === 'wasted') {
    const reason = state.terminal?.reason || (state.screen === 'busted' ? 'The police caught you.' : 'You were killed.');
    failMission(state, reason);
    return;
  }
  if (state.screen !== 'play') return;
  const definition = definitionFor(state, active.definitionId);
  if (!definition) { failMission(state, 'Mission data was lost.'); return; }

  active.remaining = Math.max(0, active.remaining - dt);
  if (active.remaining <= 0) { failMission(state, 'Time ran out.'); return; }

  if (definition.id === 'hot-car') {
    const target = state.entities.cars.find(car => car.id === active.targetVehicleId);
    if (!target || target.destroyed || target.health <= 0) {
      failMission(state, 'The hot car was destroyed.');
      return;
    }
  }

  const objective = definition.objectives[active.objectiveIndex];
  if (objective && objectiveProgress(state, definition, active, objective)) {
    const next = definition.objectives[active.objectiveIndex];
    if (!next && active.objectiveIndex >= definition.objectives.length) {
      finishMission(state, definition, 'completed', active.reward);
    } else if (objective.type !== 'collect') {
      active.objectiveIndex += 1;
      const upcoming = definition.objectives[active.objectiveIndex];
      if (!upcoming) finishMission(state, definition, 'completed', active.reward);
      else notify(state, upcoming.label, 'info');
    }
  }
}

function marker(id, point, kind, label, radius = MISSION.markerRadius) {
  return { id, x: point.x, y: point.y, radius, kind, label };
}

export function getMissionMarkers(state) {
  if (!state?.missions) return [];
  const progress = state.missions;
  if (!progress.active) {
    const definition = currentDefinition(state);
    return definition
      ? [marker('vince-marlowe', MISSION.contact, 'contact', `${MISSION.contactName} — ${definition.title}`, MISSION.markerRadius)]
      : [];
  }
  const definition = definitionFor(state, progress.active.definitionId);
  if (!definition) return [];
  const active = progress.active;
  const objective = definition.objectives[active.objectiveIndex];
  if (!objective) return [];
  if (objective.type === 'collect') {
    return objective.points.flatMap((point, index) => {
      const id = `${objective.id}-${index}`;
      return active.collectedIds.includes(id) ? [] : [marker(id, point, 'package', `Package ${index + 1}`)];
    });
  }
  if (objective.type === 'escape') return [marker(objective.id, objective.point, 'hideout', objective.label, objective.radius)];
  if (objective.type === 'steal') return [marker(objective.id, objective.point, 'car', objective.label, objective.radius)];
  if (definition.id === 'delivery') {
    const kind = objective.id === 'pickup' ? 'pickup' : 'delivery';
    return [marker(objective.id, objective.point, kind, objective.label, objective.radius)];
  }
  if (definition.id === 'hot-car' && objective.id === 'deliver-car') {
    return [marker(objective.id, objective.point, 'docks', objective.label, objective.radius)];
  }
  if (objective.point.x === MISSION.contact.x && objective.point.y === MISSION.contact.y) {
    return [marker('vince-marlowe-return', objective.point, 'contact', objective.label, objective.radius)];
  }
  return [marker(objective.id, objective.point, 'delivery', objective.label, objective.radius)];
}
