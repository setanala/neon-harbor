import { MISSION, PALETTE, PLAYER, SHOT, STEP, VEHICLE, VIEW } from './config.js';
import { hashSeed, createRng } from './random.js';
import { nearestRoadNode } from './world.js';
import { createMissionProgress } from './missions.js';
import { updateCamera } from './render.js';

export function parseShotOptions(search) {
  const params = new URLSearchParams(String(search || ''));
  const name = params.get('shot');
  if (!SHOT.names.includes(name)) return null;
  const rawSeed = params.get('seed');
  const parsed = rawSeed === null || rawSeed.trim() === '' ? SHOT.defaultSeed : Number(rawSeed);
  const seed = Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed >>> 0 : SHOT.defaultSeed;
  return { name, seed };
}

function makeCar(state, id, x, y, angle, kind = 'police', color = PALETTE.police) {
  return { id, x, y, width: VEHICLE.width, height: VEHICLE.height, angle,
    vx: 0, vy: 0, kind, color, health: VEHICLE.maxHealth, speed: 0,
    driver: kind === 'police' ? 'ai' : null, roadNodeId: nearestRoadNode(state.world, { x, y }),
    nextNodeId: null, turnAtNodeId: null, collisionCooldown: 0, ramCooldown: 0,
    respawnIn: 0, stolen: false, destroyed: false };
}

function placePlayer(state, point, angle = 0) {
  const player = state.entities.player;
  player.vehicleId = null;
  player.x = point.x; player.y = point.y; player.angle = angle;
  player.vx = 0; player.vy = 0; player.aimAngle = angle;
  player.health = PLAYER.maxHealth; player.fireCooldown = 0; player.invulnerableFor = 0;
}

function placePolice(state, positions) {
  state.entities.cars = state.entities.cars.filter(car => car.kind !== 'police');
  for (let i = 0; i < positions.length; i++) {
    const [x, y, angle = Math.PI] = positions[i];
    state.entities.cars.push(makeCar(state, `shot-police-${i + 1}`, x, y, angle));
  }
}

export function stageShot(state, options) {
  const { name, seed } = options;
  state.shot = { name, seed, staged: true };
  state.seed = seed >>> 0;
  state.time = SHOT.time;
  state.tick = Math.round(SHOT.time / STEP);
  state.dayPhase = SHOT.dayPhase;
  state.events.length = 0;
  state.effects = [];
  state.notices = [];
  state.terminal = null;
  state.wanted = { heat: 0, stars: 0, unseenFor: 0, seenThisStep: false, arrestFor: 0 };
  state.missions = createMissionProgress();

  // Keep staging tied to the fixture seed without consuming the live simulation streams.
  const fixtureRng = createRng(hashSeed(`${seed}:shot:${name}`));
  const traffic = state.entities.cars.filter(car => car.kind === 'traffic');
  if (traffic.length) {
    const parked = traffic[Math.floor(fixtureRng() * traffic.length)];
    parked.speed = 0; parked.vx = 0; parked.vy = 0; parked.driver = 'ai';
  }

  if (name === 'start') {
    state.screen = 'title';
    state.cash = 200;
    placePlayer(state, { x: 2780, y: 1760 }, 0);
    if (traffic.length) {
      const car = traffic[0]; car.x = 2750; car.y = 1680; car.speed = 0; car.vx = 0; car.vy = 0;
    }
  } else if (name === 'play') {
    state.screen = 'play'; state.cash = 800;
    placePlayer(state, { x: 2210, y: 760 }, 0);
    state.entities.player.aimAngle = 0;
    state.missions.chainIndex = 1;
    state.missions.completedCount = 1;
    state.missions.active = { definitionId: 'packages', objectiveIndex: 0, remaining: 112,
      collectedIds: ['packages-0'], targetVehicleId: null, reward: 900, timeLimit: 150 };
    state.entities.pedestrians.slice(0, 8).forEach((ped, index) => {
      const offsets = [[-95, -38], [-54, 55], [70, -45], [108, 42], [-132, 92], [155, -91], [30, 108], [-185, -90]];
      ped.x = 2280 + offsets[index][0]; ped.y = 760 + offsets[index][1];
      ped.vx = 0; ped.vy = 0; ped.mode = 'wander';
    });
    for (let i = 0; i < 4; i++) {
      const car = traffic[i];
      if (!car) continue;
      car.x = 2180 + i * 68; car.y = 650 + (i % 2) * 80;
      car.angle = i % 2 ? Math.PI : 0; car.speed = i % 2 ? 72 : 90;
      car.vx = Math.cos(car.angle) * car.speed; car.vy = Math.sin(car.angle) * car.speed;
    }
  } else if (name === 'end') {
    state.screen = 'busted'; state.cash = 2400;
    placePlayer(state, { x: MISSION.hideout.x, y: MISSION.hideout.y }, 0);
    state.wanted = { heat: 100, stars: 3, unseenFor: 0, seenThisStep: true, arrestFor: 3 };
    placePolice(state, [[700, 2210, 0], [860, 2210, Math.PI], [780, 2175, Math.PI / 2]]);
    state.missions.chainIndex = 2; state.missions.completedCount = 2;
    state.missions.lastResult = { id: 'escape', success: false, reason: 'The police caught you.', reward: 0 };
    state.terminal = { reason: 'The police caught you.', fine: 200, applied: true };
  } else {
    state.screen = 'play'; state.cash = 2000;
    const car = state.entities.cars.find(item => item.kind === 'traffic');
    const playerCar = car || makeCar(state, 'shot-player-car', 2780, 1760, 0, 'traffic', PALETTE.cars[1]);
    if (!car) state.entities.cars.push(playerCar);
    playerCar.x = 2780; playerCar.y = 1760; playerCar.angle = 0;
    playerCar.speed = 170; playerCar.vx = 170; playerCar.vy = 0;
    playerCar.driver = 'player'; playerCar.stolen = true; playerCar.kind = 'traffic';
    state.entities.player.vehicleId = playerCar.id;
    state.entities.player.x = playerCar.x; state.entities.player.y = playerCar.y;
    state.entities.player.angle = 0; state.entities.player.health = PLAYER.maxHealth;
    state.wanted = { heat: 100, stars: 3, unseenFor: 0, seenThisStep: true, arrestFor: 0 };
    placePolice(state, [[2665, 1758, 0], [2645, 1802, -0.12], [2700, 1698, 0.15], [2835, 1690, Math.PI / 2]]);
    state.missions.chainIndex = 2; state.missions.completedCount = 2;
    state.missions.active = { definitionId: 'escape', objectiveIndex: 0, remaining: 94,
      collectedIds: [], targetVehicleId: null, reward: 1400, timeLimit: 180 };
    state.notices.push({ text: 'Lose the cops, then reach the hideout.', remaining: 4, tone: 'danger' });
  }

  state.camera.width = VIEW.width; state.camera.height = VIEW.height;
  updateCamera(state, 0);
  if (name === 'start') {
    // Pull the title camera west enough to show both the street grid and coastal edge.
    state.camera.x = Math.min(state.world.width - VIEW.width / 2, 2800);
    state.camera.y = 1760;
  }
}
