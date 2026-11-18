import { DAY_NIGHT, ECONOMY, MAX_FRAME, MISSION, PLAYER, SAVE_VERSION, SCREENS, SHOT, STEP, STORAGE_KEY, VIEW, WORLD } from './config.js';
import { hashSeed, createRng } from './random.js';
import { createWorld, findFreePosition } from './world.js';
import { createEntities, updateEntities } from './entities.js';
import { createMissionProgress, failMission, startMission, updateMissions } from './missions.js';
import { createRenderer, destroyRenderer, renderFrame, resizeRenderer, screenToWorld, updateCamera } from './render.js';
import { createInput } from './input.js';
import { createAudio, destroyAudio, playSound, updateAudio } from './audio.js';
import { parseShotOptions, stageShot } from './shots.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const unsigned = value => Number(value) >>> 0;

export function createGameState(seed, save = null) {
  const normalizedSeed = unsigned(seed);
  const stream = suffix => createRng(hashSeed(`${normalizedSeed}:${suffix}`));
  const rng = { world: stream('world'), traffic: stream('traffic'), pedestrians: stream('pedestrians'),
    police: stream('police'), missions: stream('missions') };
  const world = createWorld(rng.world);
  const entities = createEntities(world, { traffic: rng.traffic, pedestrians: rng.pedestrians });
  const restored = save && save.version === SAVE_VERSION ? save : null;
  return {
    seed: restored?.seed ?? normalizedSeed, rng,
    screen: SCREENS.TITLE, returnScreen: SCREENS.TITLE,
    time: 0, tick: 0, dayPhase: DAY_NIGHT.initialPhase,
    world, entities, camera: { x: WORLD.spawn.x, y: WORLD.spawn.y, width: VIEW.width, height: VIEW.height },
    cash: restored?.cash ?? ECONOMY.startingCash,
    wanted: { heat: 0, stars: 0, unseenFor: 0, seenThisStep: false, arrestFor: 0 },
    missions: { ...createMissionProgress(), ...(restored ? {
      chainIndex: restored.chainIndex, repeatRound: restored.repeatRound,
      repeatIndex: restored.repeatIndex, completedCount: restored.completedCount,
    } : {}) },
    notices: [], effects: [], events: [], nextEntityId: 1,
    settings: { muted: Boolean(restored?.muted) }, terminal: null, shot: null,
  };
}

function validSave(data) {
  if (!data || typeof data !== 'object' || data.version !== SAVE_VERSION) return false;
  const integers = ['seed', 'cash', 'chainIndex', 'repeatRound', 'repeatIndex', 'completedCount'];
  if (integers.some(key => !Number.isSafeInteger(data[key]) || data[key] < 0)) return false;
  if (data.seed > 0xffffffff || data.cash < 0 || data.chainIndex > 4 || data.repeatIndex > 3) return false;
  if (typeof data.muted !== 'boolean') return false;
  if (data.chainIndex < 4 && (data.repeatRound !== 0 || data.repeatIndex !== 0)) return false;
  if (data.chainIndex === 4 && data.repeatRound < 1) return false;
  return true;
}

export function readSave(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return validSave(data) ? data : null;
  } catch { return null; }
}

export function writeSave(storage, state) {
  if (!storage || !state) return false;
  const save = { version: SAVE_VERSION, seed: unsigned(state.seed), cash: Math.max(0, Math.floor(state.cash)),
    chainIndex: state.missions.chainIndex, repeatRound: state.missions.repeatRound,
    repeatIndex: state.missions.repeatIndex, completedCount: state.missions.completedCount,
    muted: Boolean(state.settings.muted) };
  try { storage.setItem(STORAGE_KEY, JSON.stringify(save)); return true; }
  catch { return false; }
}

function storageFor(canvas) {
  try { return canvas.ownerDocument?.defaultView?.localStorage || null; }
  catch { return null; }
}

function safeSpawn(state) {
  const p = findFreePosition(state.world, WORLD.spawn, PLAYER.width, PLAYER.height) || { ...WORLD.spawn };
  const player = state.entities.player;
  player.x = p.x; player.y = p.y; player.angle = 0; player.vx = 0; player.vy = 0;
  player.health = PLAYER.maxHealth; player.vehicleId = null; player.aimAngle = 0;
  player.fireCooldown = 0; player.invulnerableFor = 0;
  state.entities.bullets.length = 0;
  state.wanted.heat = 0; state.wanted.stars = 0; state.wanted.unseenFor = 0;
  state.wanted.seenThisStep = false; state.wanted.arrestFor = 0;
  for (const car of state.entities.cars) if (car.driver === 'player') car.driver = car.kind === 'mission' ? null : 'ai';
  state.missions.active = null; state.terminal = null;
  state.effects.length = 0;
  state.screen = SCREENS.PLAY; state.returnScreen = SCREENS.PLAY;
}

export function startGame(canvas, status) {
  if (!canvas) throw new TypeError('A game canvas is required.');
  const doc = canvas.ownerDocument || document;
  const host = doc.defaultView || window;
  const shotOptions = parseShotOptions(host.location?.search || '');
  host.__shotReady = false;
  const storage = shotOptions ? null : storageFor(canvas);
  const saved = shotOptions ? null : readSave(storage);
  const params = new URLSearchParams(host.location?.search || '');
  const rawSeed = params.get('seed');
  const parsedSeed = rawSeed !== null && rawSeed.trim() !== '' ? Number(rawSeed) : SHOT.defaultSeed;
  const urlSeed = Number.isFinite(parsedSeed) && Number.isInteger(parsedSeed) ? parsedSeed >>> 0 : SHOT.defaultSeed;
  const state = createGameState(shotOptions?.seed ?? saved?.seed ?? urlSeed, saved);
  const renderer = createRenderer(canvas);
  renderer.status = status || renderer.status;

  if (shotOptions) {
    stageShot(state, shotOptions);
    resizeRenderer(renderer);
    updateCamera(state, 0);
    renderFrame(renderer, state);
    host.__shotReady = true;
    let destroyed = false;
    const redraw = () => {
      if (destroyed) return;
      host.__shotReady = false;
      resizeRenderer(renderer); updateCamera(state, 0); renderFrame(renderer, state);
      host.__shotReady = true;
    };
    host.addEventListener('resize', redraw);
    return { destroy() { if (destroyed) return; destroyed = true; host.removeEventListener('resize', redraw); destroyRenderer(renderer); } };
  }

  const input = createInput(canvas);
  input.attach();
  const audio = createAudio();
  let destroyed = false, raf = 0, previous = null, accumulator = 0;
  let queuedInteract = false;
  let pageSave = () => { writeSave(storage, state); };
  const initialSeed = state.seed;

  function save() { writeSave(storage, state); }
  function resetInput() { input.clear(); queuedInteract = false; }
  function setScreen(screen) {
    if (state.screen === screen) return;
    state.screen = screen; resetInput();
    if (screen === SCREENS.TITLE || screen === SCREENS.PAUSED) save();
  }
  function newGame() {
    const fresh = createGameState(initialSeed);
    Object.assign(state, fresh);
    state.cash = ECONOMY.startingCash;
    save(); setScreen(SCREENS.TITLE);
    updateCamera(state, 0);
  }
  function confirm() {
    if (state.screen === SCREENS.TITLE) {
      safeSpawn(state); updateCamera(state, 0); resetInput();
    } else if (state.screen === SCREENS.PLAY) {
      setScreen(SCREENS.PAUSED);
    } else if (state.screen === SCREENS.PAUSED) {
      setScreen(SCREENS.PLAY); accumulator = 0; previous = null;
    } else if (state.screen === SCREENS.HELP) {
      setScreen(state.returnScreen);
    } else if (state.screen === SCREENS.BUSTED || state.screen === SCREENS.WASTED) {
      safeSpawn(state); updateCamera(state, 0); save(); resetInput();
    }
  }
  function help() {
    if (state.screen === SCREENS.HELP) setScreen(state.returnScreen);
    else if ([SCREENS.TITLE, SCREENS.PLAY, SCREENS.PAUSED].includes(state.screen)) {
      state.returnScreen = state.screen;
      setScreen(SCREENS.HELP);
    }
  }
  function handleAction(action) {
    if (action === 'confirm') confirm();
    else if (action === 'help') help();
    else if (action === 'new') newGame();
  }
  function screenPoint() {
    const view = renderer.view;
    return { x: (input.mouse.x - view.x) / view.scale, y: (input.mouse.y - view.y) / view.scale };
  }
  function pointerAction() {
    if (!input.mouse.pressed.has(0) || !input.mouse.inside) return false;
    const p = screenPoint();
    const button = renderer.buttons.find(item => p.x >= item.x && p.x <= item.x + item.width && p.y >= item.y && p.y <= item.y + item.height);
    if (button) { handleAction(button.action); playSound(audio, 'click'); return true; }
    return false;
  }
  function terminalOnce() {
    if (![SCREENS.BUSTED, SCREENS.WASTED].includes(state.screen) || state.terminal?.applied) return;
    const fine = Math.min(state.cash, state.screen === SCREENS.BUSTED ? ECONOMY.bustedFine : ECONOMY.wastedFine);
    state.cash = Math.max(0, state.cash - fine);
    state.terminal = { reason: state.terminal?.reason || (state.screen === SCREENS.BUSTED ? 'The police caught you.' : 'You were killed.'), fine, applied: true };
    failMission(state, state.terminal.reason);
    save();
  }
  function drainEvents() {
    for (const event of state.events.splice(0)) {
      if (event.type === 'sound') playSound(audio, event.name);
      else if (event.type === 'terminal') {
        state.terminal = { reason: event.text || event.name, fine: 0, applied: false };
      }
    }
    terminalOnce();
  }
  function updateNotices(dt) {
    for (const notice of state.notices) notice.remaining = Math.max(0, notice.remaining - dt);
    state.notices = state.notices.filter(notice => notice.remaining > 0).slice(-8);
    for (const effect of state.effects) effect.remaining = Math.max(0, effect.remaining - dt);
    state.effects = state.effects.filter(effect => effect.remaining > 0).slice(-32);
  }
  function fixedUpdate(dt) {
    state.time += dt; state.tick += 1;
    state.dayPhase = (DAY_NIGHT.initialPhase + state.time / DAY_NIGHT.cycleSeconds) % 1;
    const player = state.entities.player;
    const pointerWorld = screenToWorld(renderer, state.camera, input.mouse.x, input.mouse.y);
    const aim = { x: pointerWorld.x - player.x, y: pointerWorld.y - player.y };
    const controls = {
      moveX: Number(input.isDown('KeyD', 'ArrowRight')) - Number(input.isDown('KeyA', 'ArrowLeft')),
      moveY: Number(input.isDown('KeyS', 'ArrowDown')) - Number(input.isDown('KeyW', 'ArrowUp')),
      sprint: input.isDown('ShiftLeft', 'ShiftRight'),
      interact: queuedInteract, fire: input.mouse.buttons.has(0) && input.mouse.inside, aim,
    };
    queuedInteract = false;
    updateEntities(state, controls, dt);
    drainEvents();
    const completedBefore = state.missions.completedCount;
    if (state.screen === SCREENS.PLAY) updateMissions(state, dt);
    else if (state.screen === SCREENS.BUSTED || state.screen === SCREENS.WASTED) updateMissions(state, dt);
    if (state.missions.completedCount !== completedBefore) save();
    updateNotices(dt);
    updateCamera(state, dt);
    updateAudio(audio, state, dt);
    if (state.screen !== SCREENS.PLAY) accumulator = 0;
  }
  function processRouting() {
    const pressed = (...codes) => input.wasPressed(...codes);
    if (pressed('KeyC')) { state.settings.muted = !state.settings.muted; save(); }
    if (pressed('KeyN') && [SCREENS.TITLE, SCREENS.PAUSED, SCREENS.BUSTED, SCREENS.WASTED].includes(state.screen)) { newGame(); return; }
    if (pressed('KeyH')) { help(); return; }
    if (pressed('Escape', 'KeyP')) {
      if (state.screen === SCREENS.PLAY) setScreen(SCREENS.PAUSED);
      else if (state.screen === SCREENS.PAUSED) { setScreen(SCREENS.PLAY); accumulator = 0; previous = null; }
    }
    if (pressed('Enter', 'Space')) confirm();
    pointerAction();
    if (state.screen === SCREENS.PLAY && pressed('KeyE')) queuedInteract = true;
    if (state.screen === SCREENS.PLAY && queuedInteract) {
      const player = state.entities.player;
      // Missions own contact precedence; otherwise the entity interaction toggles vehicle occupancy.
      const atContact = Math.hypot(player.x - MISSION.contact.x, player.y - MISSION.contact.y) <= MISSION.interactionRadius && !player.vehicleId;
      if (atContact && !state.missions.active) { startMission(state); queuedInteract = false; }
      else if (atContact && state.missions.active) queuedInteract = false;
    }
  }
  function frame(timestamp) {
    if (destroyed) return;
    processRouting();
    if (state.screen === SCREENS.PLAY) {
      if (previous === null) previous = timestamp;
      const elapsed = clamp((timestamp - previous) / 1000, 0, MAX_FRAME);
      previous = timestamp; accumulator = Math.min(MAX_FRAME, accumulator + elapsed);
      while (accumulator >= STEP && state.screen === SCREENS.PLAY) {
        fixedUpdate(STEP); accumulator -= STEP;
      }
    } else previous = timestamp;
    renderFrame(renderer, state);
    input.endFrame();
    raf = host.requestAnimationFrame(frame);
  }

  const onResize = () => { resizeRenderer(renderer); renderFrame(renderer, state); };
  const onBlur = () => { if (state.screen === SCREENS.PLAY) setScreen(SCREENS.PAUSED); accumulator = 0; previous = null; };
  const onVisibility = () => { if (doc.hidden) { accumulator = 0; previous = null; if (state.screen === SCREENS.PLAY) setScreen(SCREENS.PAUSED); } };
  host.addEventListener('resize', onResize);
  host.addEventListener('blur', onBlur);
  doc.addEventListener('visibilitychange', onVisibility);
  host.addEventListener('pagehide', pageSave);
  updateCamera(state, 0); renderFrame(renderer, state);
  raf = host.requestAnimationFrame(frame);

  return { destroy() {
    if (destroyed) return;
    destroyed = true; host.cancelAnimationFrame(raf);
    host.removeEventListener('resize', onResize); host.removeEventListener('blur', onBlur);
    doc.removeEventListener('visibilitychange', onVisibility); host.removeEventListener('pagehide', pageSave);
    input.detach(); destroyAudio(audio); destroyRenderer(renderer);
  } };
}

let booted = false;
if (typeof document !== 'undefined' && !booted) {
  const canvas = document.getElementById('game');
  if (canvas) { booted = true; startGame(canvas, document.getElementById('status')); }
}
