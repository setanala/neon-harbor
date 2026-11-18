/** NEON HARBOR tuning. Distances are world pixels; durations are seconds. */
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

export const GAME_TITLE = 'NEON HARBOR: Palm Vice';
export const STEP = 1 / 60;
export const MAX_FRAME = 0.25;
export const VIEW = freeze({ width: 1280, height: 720, maxDpr: 2, cameraSmoothing: 7 });
export const WORLD = freeze({
  width: 3600, height: 2600, roadWidth: 104, sidewalkWidth: 22,
  roadXs: [280, 780, 1280, 1780, 2280, 2780],
  roadYs: [260, 760, 1260, 1760, 2260],
  beachX: 2980, waterX: 3220, dockY: 2100,
  spawn: { x: 780, y: 760 }, laneOffset: 24, buildingInset: 44,
});
export const PLAYER = freeze({
  width: 22, height: 22, walkSpeed: 150, sprintSpeed: 235, maxHealth: 100,
  enterRadius: 65, exitOffset: 48, invulnerableSeconds: 0.65,
});
export const VEHICLE = freeze({
  width: 46, height: 26, acceleration: 280, brake: 430, drag: 90,
  maxSpeed: 440, reverseSpeed: 145, steering: 2.65, steeringMinSpeed: 12,
  maxHealth: 180, collisionDamage: 14, collisionCooldown: 0.6,
  impactMinSpeed: 100, pedestrianDamage: 45, theftHeat: 22,
});
export const TRAFFIC = freeze({ count: 36, speed: 105, turnChance: 0.3, junctionRadius: 12, respawnSeconds: 18 });
export const PEDESTRIAN = freeze({ count: 65, width: 16, height: 16, speed: 42, fleeSpeed: 125, dangerRadius: 190, fleeSeconds: 4, health: 40 });
export const COMBAT = freeze({
  weapon: 'PALM-9', fireInterval: 0.24, bulletSpeed: 880, bulletLifetime: 0.85,
  bulletDamage: 25, bulletRadius: 3, gunshotHeat: 12, assaultHeat: 28, maxBullets: 64,
});
export const WANTED = freeze({
  thresholds: [0, 20, 55, 100, 160, 230], maxHeat: 290, maxStars: 5,
  policeCounts: [0, 1, 2, 4, 5, 7], policeSpeed: 270, speedPerStar: 22,
  sightRadius: 470, loseSightSeconds: 6, decayPerSecond: 7, ramDamage: 12,
  ramCooldown: 1, arrestRadius: 55, arrestSpeed: 28, arrestSeconds: 3,
  spawnMinRadius: 650, spawnMaxRadius: 950,
});
export const MISSION = freeze({
  contactName: 'Vince Marlowe', contact: { x: 850, y: 840 }, interactionRadius: 70,
  markerRadius: 46, rewards: [600, 900, 1400, 2400], timeLimits: [100, 150, 180, 160],
  repeatScale: 0.25, maxRewardMultiplier: 3, messageSeconds: 5,
  pickup: { x: 280, y: 260 }, delivery: { x: 2780, y: 1760 },
  packages: [{ x: 1280, y: 260 }, { x: 2280, y: 760 }, { x: 280, y: 1760 }],
  hideout: { x: 780, y: 2260 }, hotCar: { x: 1780, y: 1260 }, docks: { x: 3070, y: 2260 },
});
export const ECONOMY = freeze({ startingCash: 200, bustedFine: 200, wastedFine: 100 });
export const DAY_NIGHT = freeze({ cycleSeconds: 240, initialPhase: 0.2, maxTint: 0.48 });
export const HUD = freeze({ minimapWidth: 224, minimapHeight: 162, margin: 24, messageSeconds: 4 });
export const AUDIO = freeze({ masterVolume: 0.18, engineVolume: 0.045, sirenVolume: 0.035 });
export const STORAGE_KEY = 'neon-harbor.palm-vice.save.v1';
export const SAVE_VERSION = 1;
export const SHOT = freeze({ names: ['start', 'play', 'end', 'chase'], defaultSeed: 1, time: 48, dayPhase: 0.72 });
export const SCREENS = freeze({ TITLE: 'title', PLAY: 'play', PAUSED: 'paused', HELP: 'help', BUSTED: 'busted', WASTED: 'wasted' });
export const PALETTE = freeze({
  backdrop: '#10152b', grass: '#426c62', asphalt: '#293343', roadLine: '#e7d5a0',
  sidewalk: '#abac9e', sand: '#edcb91', water: '#167b98', waterDeep: '#155572',
  palm: '#245d48', trunk: '#966548', dock: '#936947', building: '#b97e96',
  roofs: ['#cb8e9f', '#86b4bc', '#c6ad82', '#8b8da8'],
  cars: ['#f2ac57', '#37c9bc', '#e46b94', '#ad9ddd', '#e9e0c7', '#597b99'],
  player: '#fff0bc', police: '#243550', policeLight: '#58baff', danger: '#ff557d',
  neon: '#50f1d2', pink: '#ff79bc', gold: '#ffd477', text: '#fff6e7',
  muted: '#b4bed0', panel: '#131b30', night: '#131440', marker: '#ffd477',
});
export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
