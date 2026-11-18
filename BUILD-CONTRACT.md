# NEON HARBOR: Palm Vice — build contract

This document specifies the complete implementation to build. Only `config.js`, `random.js`, and `input.js` are established APIs; their exports below describe the existing code exactly. All other APIs are planned contracts. The game is an original top-down Canvas 2D open-world crime game using native ES modules, original procedural art, synthesized audio, and no external dependencies or runtime network requests (apart from loading its own local static files). Never modify `vendor/makefun-game.ts`.

## File layout and ownership

```text
BUILD-CONTRACT.md
main.ts                       Node 22 packaging entry; not the browser entry
shots.json                    Screenshot capture manifest
screenshots/                  Up to four final JPEG/PNG captures
  1-start.jpg
  2-play.jpg
  3-end.jpg
  4-chase.jpg
game/
  index.html                  Canvas, accessibility status, inline CSS, module entry
  src/
    config.js                 Existing immutable tuning and names
    random.js                 Existing seeded random utilities
    input.js                  Existing keyboard/pointer adapter
    audio.js                  Gesture-unlocked synthesized WebAudio
    world.js                  Static city generation, geometry and navigation
    entities.js               Player, cars, traffic, pedestrians, combat, police
    missions.js               Vince's chain, objectives, rewards and repeats
    render.js                 All Canvas art, camera transforms, HUD and screens
    shots.js                  Deterministic screenshot state fixtures
    main.js                   Lifecycle, fixed-step loop, state, saving, UI routing
vendor/
  makefun-game.ts             Immutable vendored packaging library
```

No additional module is required. Module dependencies flow from `config/random` to `world/audio/input`, then `entities/missions`, then `render/shots`, and finally `main`. No module imports `main`; pass state and services explicitly. `entities` emits events consumed by `missions` and `main`; it never imports missions. Render has no simulation side effects.

## Types and coordinate conventions

Signatures below use TypeScript notation for documentation; browser sources remain JavaScript. All listed functions are named exports; no default exports or additional public exports are needed. `void` means mutation of the supplied object without a return value. Internal helpers stay private.

World distances are pixels, angles radians (zero points right), velocities pixels/second, and durations seconds. Entity positions and `Rect` positions are centers: `Rect = { x:number, y:number, width:number, height:number }`. Bounds and collision use these semantics consistently. IDs are stable strings, references between entities are IDs, and array iteration order is stable. `Point = {x:number,y:number}`; `Rng = () => number`; `Screen = 'title'|'play'|'paused'|'help'|'busted'|'wasted'`; `ShotName = 'start'|'play'|'end'|'chase'`.

## Existing exports: preserve exactly

### `game/src/config.js`

There are **no exported functions**. Its recursive `freeze(value)` helper is private. Exported constants are:

```js
GAME_TITLE, STEP, MAX_FRAME, VIEW, WORLD, PLAYER, VEHICLE, TRAFFIC,
PEDESTRIAN, COMBAT, WANTED, MISSION, ECONOMY, DAY_NIGHT, HUD, AUDIO,
STORAGE_KEY, SAVE_VERSION, SHOT, SCREENS, PALETTE, FONT
```

`GAME_TITLE = 'NEON HARBOR: Palm Vice'`, `STEP = 1/60`, `MAX_FRAME = 0.25`, `STORAGE_KEY = 'neon-harbor.palm-vice.save.v1'`, `SAVE_VERSION = 1`. Object/array constants are recursively frozen. `VIEW` is 1280×720, max DPR 2, camera smoothing 7. `WORLD` is 3600×2600 with road X centers `[280,780,1280,1780,2280,2780]`, road Y centers `[260,760,1260,1760,2260]`, road width 104, sidewalk width 22, beach X 2980, water X 3220, dock Y 2100, spawn `(780,760)`, lane offset 24, building inset 44. Use the existing values in every tuning group as the source of truth; do not duplicate competing values elsewhere. `SHOT` names are start/play/end/chase, default seed 1, time 48, day phase 0.72. `SCREENS` contains TITLE/PLAY/PAUSED/HELP/BUSTED/WASTED mapped to the lowercase screen strings.

### `game/src/random.js`

Exact exported declaration parameter lists and behavior:

```js
export function hashSeed(str)        // => uint32
export function createRng(seed)      // => function rng(): number in [0,1)
export function range(rng, min, max)  // => number in [min,max)
export function int(rng, min, max)    // => inclusive integer
export function pick(rng, items)     // => selected item
export function chance(rng, probability) // => boolean
```

`hashSeed` applies FNV-1a to UTF-16 code units of `String(str)`. `createRng` hashes string seeds and coerces other seeds with `Number(seed) >>> 0`, then implements Mulberry32. `range` rejects nonfinite endpoints or max < min. `int` requires safe-integer endpoints and safe interval size. `pick` throws on an empty collection. `chance` rejects nonfinite probabilities, clamps to [0,1], and consumes one draw even at either endpoint. Validation errors are `RangeError`.

### `game/src/input.js`

Exact module export:

```js
export function createInput(canvas) // => Input
```

Creation has no DOM side effects. The returned object exposes these actual methods (not separate module exports):

```text
attach(): void
 detach(): void
clear(): void
isDown(...codes): boolean
wasPressed(...codes): boolean
endFrame(): void
```

It also exposes `keys:Set<string>`, `pressed:Set<string>`, and `mouse:{x:number,y:number,inside:boolean,buttons:Set<number>,pressed:Set<number>}`. Mouse coordinates are **canvas backing pixels**, scaled from its bounding client rect. `attach`/`detach` are idempotent. Blur, hidden document, pointer cancel, and detach clear input. Key presses ignore editable targets; repeat keydown does not create new edges. Pointer buttons use browser button numbers (left = 0). `endFrame` clears only keyboard/pointer pressed edges, preserving held input. Supported prevented game keys are WASD, arrows, both Shifts, E/P/H/C/N, Escape, Enter, and Space; the adapter also records other noneditable key codes.

## Planned module APIs

### `audio.js`

```ts
createAudio(): AudioSystem
unlockAudio(audio: AudioSystem): Promise<void>
playSound(audio: AudioSystem, name: 'shot'|'pickup'|'reward'|'impact'|'busted'|'wasted'|'click'): void
updateAudio(audio: AudioSystem, state: GameState, dt: number): void
setAudioMuted(audio: AudioSystem, muted: boolean): void
destroyAudio(audio: AudioSystem): void
```

`AudioSystem` owns nullable AudioContext/master gain, muted/unlocked flags, engine/siren nodes and private voice bookkeeping. Construct or resume the context only after a real keyboard/pointer gesture. Oscillators and generated noise implement pistol, impacts, pickups, rewards, engine pitch and alternating siren; no media files or fetches. Limit voices and disconnect ended nodes. Pausing silences loops; lack of audio support is a silent fallback. Audio never influences simulation or consumes its RNG streams. Shot mode remains silent.

### `world.js`

```ts
createWorld(rng: Rng): World
isSolid(world: World, bounds: Rect): boolean
moveWithCollisions(world: World, body: Body, dx: number, dy: number): {hitX:boolean,hitY:boolean}
findFreePosition(world: World, desired: Point, width: number, height: number): Point | null
nearestRoadNode(world: World, point: Point): string
hasLineOfSight(world: World, from: Point, to: Point): boolean
```

Generate the configured road grid with intersections, lane nodes/links and sidewalks, exactly 30 solid buildings with original signs/roof detail, the eastern beach/water, palms, and docks extending over water. Buildings occupy block interiors clear of roads and mission locations. Water is impassable except on explicit dock walkable rectangles. Palms are decorative; buildings/world bounds/water are solid. Static art uses seeded placement. Include navigable road access to the dock delivery trigger. Mission triggers and spawn locations must remain reachable. `findFreePosition` searches a bounded deterministic nearest-first offset list and returns null if none is safe. Resolve movement by swept/substepped axis-separated AABBs to avoid tunneling; rotated cars use their enclosing world-axis AABB. Return blocked axes and clamp world bounds. Road links supply legal turns and opposite lane routes for AI.

### `entities.js`

```ts
createEntities(world: World, rng: Rng): EntitySet
updateEntities(state: GameState, controls: Controls, dt: number): void
tryEnterExitVehicle(state: GameState): boolean
firePistol(state: GameState, aim: Point): boolean
addHeat(state: GameState, amount: number, source: string): void
damageEntity(state: GameState, targetId: string, amount: number, sourceId: string | null): void
getControlledBody(state: GameState): Body
```

Spawn player, 36 civilian cars, 65 pedestrians and mission hot car with unique IDs; police are additional entities. Player walk/sprint vectors normalize diagonals. E enters the nearest eligible nonpolice car within 65 pixels or exits to a collision-free side; failed exits retain occupancy. Occupancy is exclusive and the player follows their car; occupants are excluded from separate body collision. Theft adds configured heat once per theft, transferring a traffic car to player control. A destroyed occupied car ejects safely and damages its driver.

W/S or up/down accelerate/brake/reverse; A/D or left/right steer with speed-dependent response, drag, speed caps, collision damage and cooldown. Traffic follows lanes, brakes for nearby cars and picks seeded turns only once per intersection passage. Pedestrians wander sidewalks and flee recent shots, dangerous vehicles and nearby violence, returning after flee timeout. Apply dynamic AABB resolution, impact thresholds and damage without repeated per-frame damage exploits. Cap bullets at 64; mouse-held pistol fires at configured interval on foot, aimed at the world pointer. Sweep each bullet segment against solids/entities, resolve its nearest hit once, then expire it. The player cannot fire while driving.

Heat maps to 0–5 stars via configured thresholds; clamp heat to max. Police count follows `WANTED.policeCounts`, spawn at safe road positions 650–950 pixels away, pursue the controlled body, steer around solids and ram with cooldown. Track real sight using radius and occlusion; after six seconds unseen, heat decays at seven/second. Three continuous seconds within arrest radius at low controlled speed yields BUSTED; separation or speed resets arrest progress. Zero player health yields WASTED with precedence over arrest. Emit typed events for shots, impacts, crimes, pickups, transitions and sounds; main applies terminal-screen penalties once. Despawn or recycle distant surplus police safely.

### `missions.js`

```ts
createMissionCatalog(): MissionDefinition[]
createMissionProgress(): MissionProgress
startMission(state: GameState): boolean
updateMissions(state: GameState, dt: number): void
failMission(state: GameState, reason: string): void
getMissionMarkers(state: GameState): Marker[]
```

Vince Marlowe is the contact at `(850,840)`. E starts the next available mission inside his interaction radius when on foot; contact interaction takes precedence over car entry. Active objective progress is automatic at its trigger. Mission state owns objective text, countdown, package visibility, target car identity and one-time rewards. Markers feed both world rendering and minimap. Exact definitions and repeat rules follow below.

### `render.js`

```ts
createRenderer(canvas: HTMLCanvasElement): Renderer
resizeRenderer(renderer: Renderer): void
updateCamera(state: GameState, dt: number): void
screenToWorld(renderer: Renderer, camera: Camera, backingX: number, backingY: number): Point
renderFrame(renderer: Renderer, state: GameState): void
destroyRenderer(renderer: Renderer): void
```

Renderer owns context, DPR, backing size, logical viewport and letterbox transform. Fit a 1280×720 logical view to the available canvas, cap DPR at 2, clear letterbox bars and consistently invert the transform for pointer aiming. Camera stores the world-space viewport center and smoothly follows the controlled body using `1-exp(-VIEW.cameraSmoothing*dt)`, clamped to city bounds. Snap camera during spawn/reset/staging. Render world-space ground/roads/beach/docks, buildings, props, actors, bullets/effects and objective markers, then night tint, then crisp screen-space HUD and overlays. Decorative animation uses simulation time exclusively.

All imagery is original Canvas geometry/text. HUD includes title identity, health, cash, speed when driving, weapon, five wanted-star slots, mission instruction/countdown/package progress and notices. Canvas minimap uses world-to-map scale, city/coast/roads, player heading, police, Vince and active objectives with readable legend. Title offers Start/Continue and Help; pause offers Resume/Help/New Game; help explains movement, sprint, aiming/fire, E, pause, help, mute and restart. BUSTED/WASTED overlays show cause, fine and recovery action. Maintain a DOM status announcement for meaningful screen/objective changes, not each frame.

### `shots.js`

```ts
parseShotOptions(search: string): {name: ShotName, seed: number} | null
stageShot(state: GameState, options: {name: ShotName, seed: number}): void
```

Parsing accepts only the four configured names. Missing/invalid seed defaults to 1; numeric seed is a finite integer normalized to uint32. Unknown/missing shot returns null and normal gameplay. Staging mutates an already-created fresh state; never calls DOM, rendering, storage or audio. See the readiness protocol below.

### `game/src/main.js`

```ts
createGameState(seed: number, save?: SaveData | null): GameState
readSave(storage: Storage | null): SaveData | null
writeSave(storage: Storage | null, state: GameState): boolean
startGame(canvas: HTMLCanvasElement, status: HTMLElement | null): {destroy(): void}
```

The module boots once against `#game` and `#status`. Main owns input/audio/renderer services, resize/listener cleanup, screen transitions, event draining, save scheduling, shot orchestration and animation scheduling. No services or DOM nodes live inside serializable game progress. `destroy()` cancels RAF and removes all listeners/services.

`game/index.html` has no exports: original title/meta, responsive canvas, inline styles, accessible status text and `<script type="module" src="./src/main.js">`. No remote assets, fonts, analytics or CDN.

Root `main.ts` has no public exports: retain Node standard-library copy/output/dossier workflow and the existing `buildDossier` integration, packaging `game/` and `screenshots/`. Update descriptive comments only if needed in a later implementation session. `shots.json` is data with no exports. The vendor is never edited.

## Shared state

```ts
type Body = Rect & { id:string; angle:number; vx:number; vy:number };
type Player = Body & {
  health:number; vehicleId:string|null; aimAngle:number;
  fireCooldown:number; invulnerableFor:number;
};
type Car = Body & {
  kind:'traffic'|'police'|'mission'; color:string; health:number;
  speed:number; driver:'ai'|'player'|null; roadNodeId:string;
  nextNodeId:string|null; turnAtNodeId:string|null;
  collisionCooldown:number; ramCooldown:number; respawnIn:number;
  stolen:boolean; destroyed:boolean;
};
type Pedestrian = Body & {
  health:number; mode:'wander'|'flee'|'down'; target:Point;
  fleeFor:number; dangerFrom:Point|null; respawnIn:number;
};
type Bullet = {id:string; ownerId:string; x:number;y:number;
  previousX:number;previousY:number;vx:number;vy:number;life:number;damage:number};
type EntitySet = {player:Player;cars:Car[];pedestrians:Pedestrian[];bullets:Bullet[]};
type World = {
  width:number;height:number;
  roads:Rect[];sidewalks:Rect[];
  buildings:(Rect & {id:string;name:string;color:string;roofStyle:number})[];
  beach:Rect;water:Rect;docks:Rect[];
  palms:{id:string;x:number;y:number;scale:number;angle:number}[];
  roadNodes:{id:string;x:number;y:number;links:string[]}[];
  solids:Rect[]; // buildings; water exclusion is handled with dock exceptions
};
type Camera = {x:number;y:number;width:number;height:number};
type Controls = {moveX:number;moveY:number;sprint:boolean;
  interact:boolean;fire:boolean;aim:Point};
type Marker = {id:string;x:number;y:number;radius:number;
  kind:'contact'|'pickup'|'delivery'|'package'|'hideout'|'car'|'docks';label:string};
type GameEvent = {type:'sound'|'crime'|'damage'|'mission'|'notice'|'terminal';
  name:string;sourceId?:string;targetId?:string;amount?:number;text?:string};
type GameState = {
  seed:number;
  rng:{world:Rng;traffic:Rng;pedestrians:Rng;police:Rng;missions:Rng};
  screen:Screen;returnScreen:'title'|'play'|'paused';
  time:number;tick:number;dayPhase:number;
  world:World;entities:EntitySet;camera:Camera;
  cash:number;
  wanted:{heat:number;stars:number;unseenFor:number;
    seenThisStep:boolean;arrestFor:number};
  missions:MissionProgress;
  notices:{text:string;remaining:number;tone:'info'|'success'|'danger'}[];
  effects:{id:string;kind:'flash'|'impact'|'reward';x:number;y:number;
    remaining:number}[];
  events:GameEvent[];nextEntityId:number;
  settings:{muted:boolean};
  terminal:{reason:string;fine:number;applied:boolean}|null;
  shot:{name:ShotName;seed:number;staged:boolean}|null;
};
```

`world` is immutable after generation; dynamic state is mutated only in fixed updates or explicit UI/staging transitions. Set `camera.width/height` to the logical viewport dimensions. Render reads state without generating IDs, consuming RNG or changing state. Effects/notices have bounded lifetimes and arrays; events are drained once per update. Never serialize RNG closures, effects, services or the entire state.

## Missions and progression format

```ts
type Objective =
  | {id:string;type:'reach';point:Point;radius:number;label:string;
      requiredVehicle:'any'|'foot'|'target'}
  | {id:string;type:'collect';points:Point[];radius:number;label:string}
  | {id:string;type:'escape';point:Point;radius:number;requiredStars:0;label:string}
  | {id:string;type:'steal';point:Point;radius:number;label:string};
type MissionDefinition = {
  id:string;title:string;briefing:string;contactName:'Vince Marlowe';
  timeLimit:number;baseReward:number;initialHeat:number;
  objectives:Objective[];
};
type MissionProgress = {
  chainIndex:number; // next mission 0..3; 4 means initial chain complete
  repeatRound:number; // 0 during chain; 1+ during repeat cycles
  repeatIndex:number; // next mission 0..3 within repeat round
  active:null|{
    definitionId:string;objectiveIndex:number;remaining:number;
    collectedIds:string[];targetVehicleId:string|null;
    reward:number;timeLimit:number;
  };
  completedCount:number;lastResult:null|{id:string;success:boolean;reason:string;reward:number};
};
```

Definitions are fresh data from `createMissionCatalog`, in this mandatory order; coordinates/radii/rewards/times come from `MISSION`:

| ID / title | Objectives in sequence | Time / base reward |
| --- | --- | --- |
| `delivery` / Neon Express | Reach pickup `(280,260)`, then delivery `(2780,1760)`, either mode | 100 s / $600 |
| `packages` / Three Loose Ends | Collect all three unique packages `(1280,260)`, `(2280,760)`, `(280,1760)` in any order, then return to Vince | 150 s / $900 |
| `escape` / Heat Sink | Set heat to at least 100 (three stars) at mission start; lose all wanted stars and reach hideout `(780,2260)` | 180 s / $1400 |
| `hot-car` / Dockside Transfer | Enter the designated hot car at `(1780,1260)`, then deliver that exact intact car to docks `(3070,2260)` at speed ≤ 28 | 160 s / $2400 |

Only the escape mission has `initialHeat:100`; others use 0 and do not erase existing heat. Collect points have IDs derived from objective ID plus point index; each awards progress once, without per-package mission rewards. Escape completion requires both zero stars and presence in the hideout trigger. Losing the target car to destruction fails hot-car; another car cannot substitute. Hot-car theft uses ordinary theft heat. Timer runs only during PLAY. Timeout, BUSTED or WASTED fails the active mission, retaining its chain position for retry. Evaluate terminal failure, then timeout, then objective completion within a tick, so no double result occurs. Cash reward is credited once on success; transient objectives are removed on failure.

After the four initial successes, free roam continues and Vince offers repeat cycles in the same order. For repeat round `r >= 1`, reward multiplier is `min(3,1+0.25*r)` and reward is rounded to the nearest dollar; time limit is `max(45,round(baseTime/(1+0.1*r)))`. After repeat index 3 succeeds, increment round and reset index to 0. Failure never advances either index. Recreate destroyed/missing mission cars safely when retrying. Objective instruction, timer, contact availability and marker visibility derive from progress, not duplicated UI flags.

## Simulation, controls and terminal flow

Main uses a fixed `STEP = 1/60` accumulator with elapsed RAF time clamped to `MAX_FRAME = 0.25`. Each simulation step advances time/tick, computes day phase, updates entities, processes terminal conditions, updates missions and bounded effects/notices, drains events, then updates camera. Render once per RAF. No physics update occurs in title/help/pause/terminal screens. Clear accumulator on resume and visibility changes to avoid catch-up.

Held input applies to every step; queue one-shot actions until the first eligible step, consume once, and call `input.endFrame()` after RAF processing (including frames without a simulation step). This prevents lost E presses and multiple entries during catch-up. Aim converts backing pixels through renderer/letterbox and camera transforms. Ignore fire outside the canvas or over overlay controls. E prioritizes Vince interaction, then vehicle toggle; overlapping triggers must not perform both.

WASD/arrows move/drive, Shift sprints on foot, mouse aims, left button fires, E interacts, Escape/P pauses/resumes, H opens/closes help using returnScreen, C toggles mute, Enter/Space confirms Start/Continue/Resume/recovery, and N starts a fresh game from title/pause/terminal UI. Canvas buttons share the same actions. Reset input on screen changes. Blurring pauses active play. BUSTED applies up to $200 fine, WASTED up to $100, never taking cash negative; each applies only once, fails the mission and saves progress. Recovery respawns on foot at the safe spawn with full health, zero heat and no bullets/arrest timer; retain earned progression/cash. Starting New Game resets progression/cash to $200 and save state.

## Seeded generation and reproducibility

Use the existing Mulberry32 implementation exclusively for gameplay randomness; never `Math.random()`. Normalize the URL seed numerically before passing it to `createGameState` (the existing RNG treats string `"1"` differently from numeric `1`). Derive independent streams as `createRng(hashSeed(String(seed)+':world'))`, with suffixes `traffic`, `pedestrians`, `police`, `missions` for their respective systems. Generate world first with fixed loop ordering, then initial entity populations. Keep stable IDs and deterministic update order. Runtime AI randomness is consumed only on defined decisions, never render calls. Cosmetic variation derives from stable ID hashes or time and never consumes simulation streams.

Normal play defaults to seed 1 when unspecified; saving records the normalized seed. Restart regenerates the city from that seed. Day phase is `(DAY_NIGHT.initialPhase + time/DAY_NIGHT.cycleSeconds) % 1`, with a smooth tint curve capped at `maxTint`; HUD is not tinted. Shot fixtures explicitly override phase. Determinism is guaranteed for the same seed, staged fixture and viewport, independent of wall-clock, refresh rate, storage, or audio support.

## Save contract

```ts
type SaveData = {
  version:1;seed:number;cash:number;
  chainIndex:number;repeatRound:number;repeatIndex:number;completedCount:number;
  muted:boolean;
};
```

Use `STORAGE_KEY`/`SAVE_VERSION`. Read/write within try/catch; missing, corrupt, wrong-version or unavailable storage falls back to a new game without crashing. Validate finite numeric values, uint32 seed, nonnegative integer cash/counts, chainIndex 0..4, repeatIndex 0..3, and consistent chain/repeat fields; ignore invalid payloads. Saving is a safe checkpoint: active missions, position, health, cars and wanted heat do not persist. Continue restores cash/progression/settings into a newly seeded city at the safe spawn with full health and no active mission. Save after success, terminal fine, mute changes, new game and pause/pagehide; do not write every frame. Shot mode neither reads nor writes storage.

## Shot-mode staging and capture protocol

Opening `game/index.html?shot=start|play|end|chase&seed=1` (substitute one actual name) must immediately build a deterministic staged scene without interaction. At startup set `window.__shotReady = false`. Detect shot mode before reading storage, attaching interactive gameplay, unlocking audio or starting a live simulation. Create fresh seeded state, run `stageShot`, size the renderer, snap camera, and render the complete scene. Set `window.__shotReady = true` **only after** that render returns successfully; no timeout-based readiness and no true value on error. System fonts and procedural art require no remote asset waits.

Stage time to `SHOT.time` (48), tick to `48/STEP`, phase to `SHOT.dayPhase` (0.72). Establish all positions, headings, health, heat, mission progress, effects and notices explicitly; do not simulate a variable number of RAFs to arrive there. Freeze simulation, camera interpolation, audio, timers and decorative animation afterward. A resize redraws the identical fixture at its new transform; hold readiness false until its redraw completes. Repeat captures at 1280×720 with DPR 1 for canonical composition.

| Shot | Required deterministic composition |
| --- | --- |
| `start` | TITLE overlay with game identity, Start/Help and controls over a visible coastal city backdrop, palms and a parked original car; no active mission |
| `play` | PLAY HUD, player on foot near the package objective at `(2280,760)`, aim east, first package collected, two visible remaining markers, second mission active with 112 seconds, $800, zero stars; populated street and minimap |
| `end` | BUSTED overlay over a visible police stop near `(780,2260)`; $2400 after fine, terminal fine $200 already applied, failed escape mission result, three police cars, no active countdown; no save side effects |
| `chase` | PLAY HUD, player driving near `(2780,1760)` with three stars (heat 100), four police arranged behind/beside the car, escape mission active with 94 seconds and hideout marker, visible siren colors and coastal city detail |

Fixtures may reposition seeded actors to keep composition readable and prevent overlaps; use fixed offsets and collision-safe positions. Staged vehicles/bullets/effects never move after readiness. End fixture uses canonical BUSTED screen rather than inventing an unsupported screen value. Normal gameplay must not depend on `window.__shotReady`.

`shots.json` is a JSON array in capture/cover order:

```json
[
  { "name": "1-start.jpg", "query": "?shot=start&seed=1" },
  { "name": "2-play.jpg", "query": "?shot=play&seed=1" },
  { "name": "3-end.jpg", "query": "?shot=end&seed=1" },
  { "name": "4-chase.jpg", "query": "?shot=chase&seed=1" }
]
```

Capture automation loads the local game URL plus each query and waits for `window.__shotReady === true`. Keep each final image ≤256 KiB and at most four images, matching existing packaging limits. This document defines future implementation; it does not authorize modifications to the vendor or require any other file change in the contract-writing session.
