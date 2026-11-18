import { GAME_TITLE, VIEW, WORLD, PLAYER, COMBAT, DAY_NIGHT, HUD, MISSION, PALETTE as P, FONT } from './config.js';
import { hashSeed } from './random.js';
import { getControlledBody } from './entities.js';
import { createMissionCatalog, getMissionMarkers } from './missions.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const catalog = createMissionCatalog();

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('NEON HARBOR requires a Canvas 2D context.');
  const renderer = { canvas, context, dpr: 1, width: 0, height: 0,
    viewport: { width: VIEW.width, height: VIEW.height },
    view: { scale: 1, x: 0, y: 0 }, buttons: [],
    status: canvas.ownerDocument?.getElementById('status') || null,
    lastAnnouncement: '', destroyed: false };
  resizeRenderer(renderer);
  return renderer;
}

export function resizeRenderer(renderer) {
  if (renderer.destroyed) return;
  const { canvas } = renderer;
  const host = canvas.ownerDocument?.defaultView;
  const bounds = canvas.getBoundingClientRect();
  renderer.dpr = clamp(host?.devicePixelRatio || 1, 1, VIEW.maxDpr);
  renderer.width = Math.max(1, Math.round((bounds.width || host?.innerWidth || VIEW.width) * renderer.dpr));
  renderer.height = Math.max(1, Math.round((bounds.height || host?.innerHeight || VIEW.height) * renderer.dpr));
  if (canvas.width !== renderer.width) canvas.width = renderer.width;
  if (canvas.height !== renderer.height) canvas.height = renderer.height;
  const scale = Math.min(renderer.width / VIEW.width, renderer.height / VIEW.height);
  renderer.view = { scale, x: (renderer.width - VIEW.width * scale) / 2,
    y: (renderer.height - VIEW.height * scale) / 2 };
}

export function updateCamera(state, dt) {
  const body = getControlledBody(state), camera = state.camera;
  camera.width = VIEW.width;
  camera.height = VIEW.height;
  const x = clamp(body.x, Math.min(camera.width / 2, state.world.width / 2),
    Math.max(state.world.width - camera.width / 2, state.world.width / 2));
  const y = clamp(body.y, Math.min(camera.height / 2, state.world.height / 2),
    Math.max(state.world.height - camera.height / 2, state.world.height / 2));
  // A zero-duration call explicitly snaps spawn/reset/fixture cameras.
  const blend = dt <= 0 || !Number.isFinite(camera.x) || !Number.isFinite(camera.y)
    ? 1 : 1 - Math.exp(-VIEW.cameraSmoothing * dt);
  camera.x = clamp((Number.isFinite(camera.x) ? camera.x : x) + (x - (Number.isFinite(camera.x) ? camera.x : x)) * blend,
    Math.min(camera.width / 2, state.world.width / 2), Math.max(state.world.width - camera.width / 2, state.world.width / 2));
  camera.y = clamp((Number.isFinite(camera.y) ? camera.y : y) + (y - (Number.isFinite(camera.y) ? camera.y : y)) * blend,
    Math.min(camera.height / 2, state.world.height / 2), Math.max(state.world.height - camera.height / 2, state.world.height / 2));
}

export function screenToWorld(renderer, camera, backingX, backingY) {
  const { scale, x, y } = renderer.view;
  return { x: (backingX - x) / scale + camera.x - camera.width / 2,
    y: (backingY - y) / scale + camera.y - camera.height / 2 };
}

function box(c, x, y, w, h, color) {
  c.fillStyle = color; c.fillRect(x, y, w, h);
}
function rect(c, r, color) { box(c, r.x - r.width / 2, r.y - r.height / 2, r.width, r.height, color); }
function line(c, x, y, xx, yy, color, width = 1) {
  c.strokeStyle = color; c.lineWidth = width; c.beginPath(); c.moveTo(x, y); c.lineTo(xx, yy); c.stroke();
}
function circle(c, x, y, r, color) {
  c.fillStyle = color; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
}
function text(c, value, x, y, size = 16, color = P.text, align = 'left', weight = 500) {
  c.font = `${weight} ${size}px ${FONT}`; c.fillStyle = color;
  c.textAlign = align; c.textBaseline = 'middle'; c.fillText(String(value), x, y);
}
function wrapped(c, value, x, y, width, size = 16, color = P.text, lineHeight = 23) {
  c.font = `500 ${size}px ${FONT}`;
  let row = '', count = 0;
  for (const word of String(value).split(/\s+/)) {
    const next = row ? `${row} ${word}` : word;
    if (row && c.measureText(next).width > width) {
      text(c, row, x, y + count++ * lineHeight, size, color); row = word;
    } else row = next;
  }
  if (row) text(c, row, x, y + count++ * lineHeight, size, color);
  return count * lineHeight;
}
function visible(camera, r, pad = 90) {
  return Math.abs(r.x - camera.x) < (camera.width + (r.width || 0)) / 2 + pad &&
    Math.abs(r.y - camera.y) < (camera.height + (r.height || 0)) / 2 + pad;
}
function diamond(c, x, y, radius, color) {
  c.fillStyle = color; c.beginPath(); c.moveTo(x, y - radius); c.lineTo(x + radius, y);
  c.lineTo(x, y + radius); c.lineTo(x - radius, y); c.closePath(); c.fill();
}
function star(c, x, y, radius, color) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? radius * 0.44 : radius;
    if (i === 0) c.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    else c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  c.closePath(); c.fillStyle = color; c.fill();
}

function ground(c, state) {
  const w = state.world;
  box(c, 0, 0, w.width, w.height, P.grass);
  rect(c, w.beach, P.sand); rect(c, w.water, P.water);
  const shore = w.water.x - w.water.width / 2;
  box(c, shore + 90, 0, Math.max(0, w.width - shore - 90), w.height, P.waterDeep);
  // Wave and sand patterns are fixed by position and simulation time.
  for (let y = Math.floor((state.camera.y - VIEW.height / 2) / 58) * 58; y < state.camera.y + VIEW.height / 2 + 58; y += 58) {
    const wave = Math.sin(y * 0.025 + state.time * 0.7) * 8;
    line(c, shore + wave, y, shore + wave + 10, y + 33, '#9ce0cb', 3);
    const shimmer = 0.22 + (Math.sin(state.time * 2.1 + y * 0.045) + 1) * 0.12;
    c.save(); c.globalAlpha = shimmer;
    const glintX = shore + 29 + Math.sin(state.time * 0.55 + y * 0.03) * 8;
    line(c, glintX, y + 12, glintX + 16, y + 10, '#b8f2df', 2);
    line(c, glintX + 28, y + 36, glintX + 37, y + 35, '#e0fff0', 1.5);
    c.restore();
    for (let x = shore + 45; x < w.width; x += 88) line(c, x, y + Math.sin(x) * 12, x + 23, y + Math.sin(x) * 12, '#428b9d', 2);
    for (let x = WORLD.beachX + 30; x < shore - 15; x += 65) box(c, x, y + x % 29, 3, 2, '#d7ad75');
  }
  for (const s of w.sidewalks) rect(c, s, P.sidewalk);
  for (const r of w.roads) rect(c, r, P.asphalt);
  c.setLineDash([22, 20]);
  for (const r of w.roads) {
    if (r.height > r.width) line(c, r.x, r.y - r.height / 2, r.x, r.y + r.height / 2, P.roadLine, 2);
    else line(c, r.x - r.width / 2, r.y, r.x + r.width / 2, r.y, P.roadLine, 2);
  }
  c.setLineDash([]);
  for (const x of WORLD.roadXs) for (const y of WORLD.roadYs) {
    if (!visible(state.camera, { x, y }, 100)) continue;
    box(c, x - 49, y - 49, 98, 98, P.asphalt);
    for (let i = -3; i <= 3; i++) {
      box(c, x + i * 11 - 3, y - 66, 6, 13, '#d9d6be');
      box(c, x + i * 11 - 3, y + 53, 6, 13, '#d9d6be');
    }
    // Street lamps and bins are decorative props, outside the traffic lanes.
    circle(c, x + 66, y - 66, 5, '#324650');
    circle(c, x + 66, y - 66, 2, P.gold);
    box(c, x - 70, y + 60, 9, 13, '#285c60');
    line(c, x - 70, y + 63, x - 61, y + 63, P.neon, 2);
  }
  for (const d of w.docks) {
    rect(c, { ...d, x: d.x + 7, y: d.y + 8 }, '#123f55'); rect(c, d, P.dock);
    for (let x = d.x - d.width / 2 + 5; x < d.x + d.width / 2; x += 13)
      line(c, x, d.y - d.height / 2, x, d.y + d.height / 2, '#73523e');
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) circle(c, d.x + dx * (d.width / 2 - 7), d.y + dy * (d.height / 2 - 7), 5, '#deb783');
  }
}
function building(c, b) {
  const x = b.x - b.width / 2, y = b.y - b.height / 2;
  box(c, x + 12, y + 16, b.width, b.height, '#203943');
  rect(c, b, '#594e69');
  box(c, x, y, b.width, b.height - 12, b.color);
  box(c, x + 9, y + 9, b.width - 18, b.height - 32, '#00000019');
  c.strokeStyle = '#ffffff32'; c.lineWidth = 2; c.strokeRect(x + 6, y + 6, b.width - 12, b.height - 24);
  for (let xx = x + 18; xx < x + b.width - 10; xx += 32) {
    box(c, xx, y + b.height - 10, 17, 6, b.roofStyle % 2 ? P.neon : P.gold);
  }
  if (b.roofStyle === 1) {
    box(c, x + 25, y + 24, Math.max(35, b.width * 0.45), Math.max(24, b.height * 0.32), '#447987');
    line(c, x + 29, y + 30, x + b.width * 0.45, y + 30, '#96d6cb', 3);
  } else {
    box(c, x + 20, y + 22, 36, 26, '#5f7380');
    for (let i = 0; i < 4; i++) line(c, x + 24, y + 27 + i * 5, x + 51, y + 27 + i * 5, '#a9b9b8', 2);
  }
  if (b.roofStyle === 3) {
    circle(c, x + b.width - 33, y + 35, 17, '#c4b6c0');
    line(c, x + b.width - 33, y + 35, x + b.width - 19, y + 16, '#eee0cf', 3);
  }
  const size = Math.min(17, (b.width - 22) / Math.max(5, b.name.length * 0.62));
  box(c, b.x - (b.width - 16) / 2, y + b.height - 43, b.width - 16, 25, P.panel);
  text(c, b.name.toUpperCase(), b.x, y + b.height - 30, size, b.roofStyle % 2 ? P.neon : P.pink, 'center', 800);
  // Crates and a bench sit beside the facade.
  box(c, x + 6, y + b.height + 4, 19, 16, '#9b805d');
  line(c, x + 8, y + b.height + 6, x + 23, y + b.height + 18, '#d0b586');
  box(c, x + b.width - 53, y + b.height + 7, 35, 7, '#d9b68a');
}
function palm(c, p, time) {
  c.save(); c.translate(p.x, p.y); c.scale(p.scale, p.scale);
  circle(c, 11, 10, 23, '#112c3538');
  line(c, 5, 10, -4, -12, P.trunk, 7);
  c.translate(-4, -12); c.rotate(p.angle + Math.sin(time * 0.8 + p.x) * 0.04);
  for (let i = 0; i < 7; i++) {
    c.rotate(TAU / 7); c.fillStyle = i % 2 ? '#347954' : P.palm;
    c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(15, -16, 43, 1);
    c.quadraticCurveTo(19, -3, 5, 7); c.closePath(); c.fill();
    line(c, 2, 0, 35, 0, '#65a16b', 1);
  }
  circle(c, 0, 0, 5, '#b79c55'); c.restore();
}
function car(c, v, time) {
  c.save(); c.translate(v.x, v.y); c.rotate(v.angle);
  const w = v.width, h = v.height;
  box(c, -w / 2 + 3, -h / 2 + 4, w, h, '#0b152b66');
  for (const xx of [-w * 0.3, w * 0.3]) for (const yy of [-h / 2, h / 2 - 3]) box(c, xx - 5, yy - 2, 10, 5, '#131a27');
  box(c, -w / 2, -h / 2, w, h, v.destroyed ? '#41414c' : v.color);
  box(c, -w * 0.23, -h / 2 + 2, w * 0.48, h - 4, v.kind === 'police' ? '#e6e4da' : '#ffffff29');
  box(c, w * 0.1, -h / 2 + 3, w * 0.15, h - 6, '#203c50');
  box(c, -w * 0.28, -h / 2 + 3, w * 0.1, h - 6, '#203c50');
  for (const yy of [-h / 2 + 3, h / 2 - 6]) {
    box(c, w / 2 - 3, yy, 3, 4, '#fff0ae'); box(c, -w / 2, yy, 3, 4, P.danger);
  }
  if (v.kind === 'police' && !v.destroyed) {
    const flip = Math.sin(time * 12 + hashSeed(v.id) % 7) > 0;
    box(c, -3, -9, 6, 9, flip ? P.danger : '#873553');
    box(c, -3, 0, 6, 9, flip ? '#315881' : P.policeLight);
    c.globalAlpha = 0.14; circle(c, 0, flip ? -8 : 8, 26, flip ? P.danger : P.policeLight); c.globalAlpha = 1;
  }
  if (v.destroyed) {
    line(c, -16, -8, 15, 8, '#161b26', 3); line(c, -10, 8, 14, -10, '#161b26', 3);
  } else if (v.health < 60) {
    circle(c, w / 2 - 8, -3, 9, '#34404c99');
  }
  c.restore();
}
function person(c, p, player, time) {
  c.save(); c.translate(p.x, p.y); c.rotate(player ? p.aimAngle : p.angle);
  if (p.mode === 'down' || p.health <= 0) {
    box(c, -12, -5, 24, 10, '#6b5968'); circle(c, 12, 0, 5, '#c9987a');
  } else {
    const step = Math.sin(time * (p.mode === 'flee' ? 19 : 11) + hashSeed(p.id)) * Math.min(3, Math.hypot(p.vx, p.vy) / 30);
    circle(c, 2, 4, 12, '#10172855');
    box(c, -6 + step, -7, 9, 5, '#293149'); box(c, -6 - step, 2, 9, 5, '#293149');
    circle(c, 0, 0, player ? 10 : 8, player ? '#e773a9' : P.cars[hashSeed(p.id) % P.cars.length]);
    circle(c, 3, 0, player ? 6 : 5, player ? P.player : '#d9ad8f');
    if (player) { box(c, 6, 4, 12, 4, '#ffe1b0'); box(c, 14, 3, 10, 4, '#172738'); }
  }
  c.restore();
}
function markers(c, state, list) {
  for (const m of list) {
    if (!visible(state.camera, m)) continue;
    const color = m.kind === 'contact' ? P.pink : P.gold;
    const pulse = 1 + Math.sin(state.time * 3) * 0.07;
    c.save(); c.globalAlpha = 0.12; circle(c, m.x, m.y, m.radius * pulse, color); c.restore();
    c.strokeStyle = color; c.lineWidth = 2; c.beginPath(); c.arc(m.x, m.y, m.radius * pulse, 0, TAU); c.stroke();
    diamond(c, m.x, m.y - 40, 13, color);
    text(c, m.kind === 'contact' ? 'V' : m.kind === 'package' ? '+' : '↓', m.x, m.y - 40, 15, P.panel, 'center', 900);
    if (m.kind === 'package' || m.kind === 'pickup') {
      box(c, m.x - 9, m.y - 7, 18, 14, '#d9b482'); line(c, m.x, m.y - 7, m.x, m.y + 7, '#fff1c2', 3);
    }
    c.font = `700 12px ${FONT}`;
    const labelWidth = c.measureText(m.label).width + 20;
    box(c, m.x - labelWidth / 2, m.y + m.radius + 8, labelWidth, 24, '#10182be8');
    text(c, m.label, m.x, m.y + m.radius + 20, 12, color, 'center', 700);
  }
}
function objective(state) {
  const a = state.missions.active;
  if (!a) return { title: 'THE CITY IS YOURS', instruction: `Find ${MISSION.contactName} · E to take a job` };
  const def = catalog.find(d => d.id === a.definitionId);
  const o = def?.objectives[a.objectiveIndex];
  return { title: def?.title.toUpperCase() || 'VINCE’S JOB', instruction: o?.label || 'Complete the job',
    packages: o?.type === 'collect' ? `${a.collectedIds.length}/${o.points.length} PACKAGES` : null };
}
function minimap(c, state, list) {
  const width = HUD.minimapWidth, height = HUD.minimapHeight;
  const x = HUD.margin, y = VIEW.height - HUD.margin - height - 25;
  box(c, x - 2, y - 23, width + 4, height + 51, '#10182bf2');
  text(c, 'PALM VICE  /  GPS', x + 10, y - 10, 11, P.neon, 'left', 800);
  c.save(); c.beginPath(); c.rect(x, y, width, height); c.clip();
  const scale = Math.min(width / state.world.width, height / state.world.height);
  c.translate(x + (width - state.world.width * scale) / 2, y + (height - state.world.height * scale) / 2); c.scale(scale, scale);
  box(c, 0, 0, state.world.width, state.world.height, '#284e4f');
  rect(c, state.world.beach, '#b69e74'); rect(c, state.world.water, '#20566e');
  for (const road of state.world.roads) rect(c, road, '#85919a');
  for (const dock of state.world.docks) rect(c, dock, '#af9374');
  for (const b of state.world.buildings) rect(c, b, '#3b455d');
  const r = 3 / scale;
  diamond(c, MISSION.contact.x, MISSION.contact.y, r, P.pink);
  for (const m of list) if (m.kind !== 'contact') diamond(c, m.x, m.y, r + 9, P.gold);
  for (const v of state.entities.cars) if (v.kind === 'police' && !v.destroyed) circle(c, v.x, v.y, 2.5 / scale, P.policeLight);
  const body = getControlledBody(state);
  c.save(); c.translate(body.x, body.y); c.rotate(state.entities.player.vehicleId ? body.angle : state.entities.player.aimAngle);
  c.fillStyle = P.text; c.strokeStyle = P.panel; c.lineWidth = 1.5 / scale;
  c.beginPath(); c.moveTo(6 / scale, 0); c.lineTo(-4 / scale, -4 / scale); c.lineTo(-2 / scale, 0); c.lineTo(-4 / scale, 4 / scale); c.closePath(); c.fill(); c.stroke(); c.restore();
  c.restore();
  text(c, 'N ↑', x + width - 29, y + 13, 10, P.text, 'center', 800);
  text(c, '◆ Vince', x + 8, y + height + 14, 10, P.pink);
  text(c, '◆ Job', x + 80, y + height + 14, 10, P.gold);
  text(c, '● Police', x + 140, y + height + 14, 10, P.policeLight);
}
function hud(c, state, list, o) {
  const m = HUD.margin;
  box(c, m, m, 340, 85, '#10182bee');
  box(c, m, m, 4, 85, P.neon);
  text(c, 'NEON HARBOR', m + 18, m + 24, 23, P.text, 'left', 900);
  text(c, 'P A L M   V I C E', m + 19, m + 49, 11, P.pink, 'left', 800);
  text(c, 'HEALTH', m + 18, m + 69, 10, P.muted, 'left', 800);
  box(c, m + 77, m + 64, 186, 10, '#343b52');
  box(c, m + 77, m + 64, 186 * clamp(state.entities.player.health / PLAYER.maxHealth, 0, 1), 10,
    state.entities.player.health < 30 ? P.danger : P.neon);
  text(c, Math.ceil(state.entities.player.health), m + 279, m + 69, 12, P.text);
  box(c, VIEW.width - m - 270, m, 270, 111, '#10182bee');
  text(c, `$${Math.floor(state.cash).toLocaleString('en-US')}`, VIEW.width - m - 16, m + 25, 29, P.neon, 'right', 800);
  for (let i = 0; i < 5; i++) star(c, VIEW.width - m - 151 + i * 31, m + 59, 12, i < state.wanted.stars ? P.gold : '#485066');
  const driving = Boolean(state.entities.player.vehicleId);
  text(c, driving ? `${Math.round(Math.abs(getControlledBody(state).speed || 0))} PX/S  ·  DRIVING` : `${COMBAT.weapon}  ·  PISTOL`,
    VIEW.width - m - 16, m + 91, 12, P.text, 'right', 800);
  const ox = 385, ow = 570;
  box(c, ox, m, ow, 85, '#10182bee'); box(c, ox, m, 3, 85, P.gold);
  text(c, o.title, ox + 17, m + 20, 12, P.gold, 'left', 900);
  wrapped(c, o.instruction, ox + 17, m + 44, ow - 130, 14, P.text, 19);
  if (state.missions.active) {
    const remaining = Math.max(0, Math.ceil(state.missions.active.remaining));
    text(c, `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`, ox + ow - 18, m + 28, 27,
      remaining < 20 ? P.danger : P.text, 'right', 800);
    if (o.packages) text(c, o.packages, ox + ow - 18, m + 65, 10, P.neon, 'right', 800);
  }
  minimap(c, state, list);
  text(c, 'WASD move / drive   SHIFT sprint   E interact   MOUSE aim + fire   P pause   H help', VIEW.width - m, VIEW.height - 21, 11, '#edf0df', 'right');
  text(c, state.settings.muted ? 'C  SOUND OFF' : 'C  SOUND ON', VIEW.width - m, VIEW.height - 44, 10, P.muted, 'right');
  let yy = 130;
  for (const n of state.notices.filter(n => n.remaining > 0).slice(-3)) {
    const color = n.tone === 'danger' ? P.danger : n.tone === 'success' ? P.neon : P.gold;
    c.font = `500 14px ${FONT}`;
    const rows = Math.max(1, Math.ceil(c.measureText(n.text).width / 650));
    box(c, 305, yy - 14, 670, 14 + rows * 22, '#10182be8');
    const h = wrapped(c, n.text, 317, yy + 2, 646, 14, color, 22); yy += h + 25;
  }
  if (state.wanted.arrestFor > 0 && state.screen === 'play') {
    box(c, 485, 625, 310, 35, '#161b30ed');
    text(c, 'POLICE CLOSING IN — MOVE!', 640, 642, 15, P.danger, 'center', 900);
  }
}
function button(renderer, label, x, y, width, action, primary = false) {
  const c = renderer.context, height = 48;
  box(c, x, y, width, height, primary ? P.neon : '#2c3550');
  text(c, label, x + width / 2, y + height / 2, 15, primary ? P.panel : P.text, 'center', 800);
  // Logical hit regions let the lifecycle owner route pointer actions without render-side input listeners.
  renderer.buttons.push({ x, y, width, height, action });
}
function overlay(renderer, state) {
  const c = renderer.context, screen = state.screen;
  if (screen === 'play') return;
  box(c, 0, 0, VIEW.width, VIEW.height, screen === 'title' ? '#080d2475' : '#080d24a8');
  if (screen === 'title') {
    box(c, 64, 144, 644, 456, '#11182bea'); box(c, 64, 144, 5, 456, P.pink);
    text(c, 'AN OPEN-WORLD HARBOR STORY', 98, 184, 12, P.neon, 'left', 800);
    text(c, 'NEON', 94, 249, 78, P.text, 'left', 900);
    text(c, 'HARBOR', 94, 326, 78, P.text, 'left', 900);
    text(c, 'P A L M   V I C E', 99, 388, 28, P.pink, 'left', 800);
    text(c, 'Fast streets. Loose ends. One more job for Vince.', 100, 438, 17, P.muted);
    const continued = state.cash !== 200 || state.missions.completedCount > 0;
    button(renderer, continued ? 'CONTINUE  /  ENTER' : 'START  /  ENTER', 100, 476, 279, 'confirm', true);
    button(renderer, 'HELP  /  H', 393, 476, 177, 'help');
    text(c, 'WASD drive / walk · E interact · Mouse aim / fire', 100, 554, 13, P.muted);
    text(c, 'N new game · C sound · P pause', 100, 576, 12, P.muted);
    text(c, 'THE COAST NEVER SLEEPS.', 1208, 654, 16, P.gold, 'right', 900);
    return;
  }
  const x = 320, y = screen === 'help' ? 97 : 182, width = 640;
  const height = screen === 'help' ? 526 : 360;
  box(c, x, y, width, height, '#11182bf5'); box(c, x, y, width, 4, screen === 'busted' || screen === 'wasted' ? P.danger : P.neon);
  if (screen === 'help') {
    text(c, 'KNOW THE STREETS', 640, y + 49, 31, P.text, 'center', 900);
    const help = [
      ['WASD / ARROWS', 'Walk · accelerate, brake / reverse, steer'],
      ['SHIFT', 'Sprint while on foot'], ['MOUSE / LEFT CLICK', 'Aim / fire your PALM-9 on foot'],
      ['E', 'Talk to Vince · enter / exit the nearest car'], ['ESC / P', 'Pause / resume'],
      ['H', 'Open / close this guide'], ['C', 'Mute / unmute sound'],
      ['ENTER / SPACE', 'Start · continue · resume · recover'], ['N', 'New game from title, pause or recovery'],
    ];
    for (let i = 0; i < help.length; i++) {
      text(c, help[i][0], x + 30, y + 105 + i * 33, 12, P.neon, 'left', 800);
      text(c, help[i][1], x + 210, y + 105 + i * 33, 13, P.text);
    }
    text(c, '◆ Gold: objective    ◆ Pink: Vince    ● Blue: police', 640, y + 420, 13, P.gold, 'center');
    button(renderer, 'BACK  /  H', x + 174, y + 456, 292, 'help', true);
  } else if (screen === 'paused') {
    text(c, 'CITY ON HOLD', 640, y + 69, 43, P.text, 'center', 900);
    text(c, 'Catch your breath. The harbor can wait.', 640, y + 122, 17, P.muted, 'center');
    button(renderer, 'RESUME  /  ENTER', x + 48, y + 174, 544, 'confirm', true);
    button(renderer, 'HELP  /  H', x + 48, y + 239, 262, 'help');
    button(renderer, 'NEW GAME  /  N', x + 330, y + 239, 262, 'new');
  } else if (screen === 'busted' || screen === 'wasted') {
    text(c, screen.toUpperCase(), 640, y + 68, 65, P.danger, 'center', 900);
    wrapped(c, state.terminal?.reason || (screen === 'busted' ? 'The patrol caught up with you.' : 'You went down on the streets.'), x + 48, y + 130, 544, 17, P.text);
    text(c, `FINE  $${state.terminal?.fine || 0}     ·     CASH  $${Math.floor(state.cash).toLocaleString('en-US')}`, 640, y + 192, 17, P.gold, 'center', 800);
    button(renderer, 'RECOVER  /  ENTER', x + 48, y + 235, 340, 'confirm', true);
    button(renderer, 'NEW  /  N', x + 404, y + 235, 188, 'new');
    text(c, 'Return to the safehouse with full health and a clean slate.', 640, y + 313, 13, P.muted, 'center');
  }
}

export function renderFrame(renderer, state) {
  if (renderer.destroyed) return;
  const c = renderer.context, v = renderer.view, camera = state.camera;
  renderer.buttons.length = 0;
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1;
  box(c, 0, 0, renderer.width, renderer.height, P.backdrop);
  c.save(); c.setTransform(v.scale, 0, 0, v.scale, v.x, v.y);
  c.beginPath(); c.rect(0, 0, VIEW.width, VIEW.height); c.clip();
  c.save(); c.translate(VIEW.width / 2 - camera.x, VIEW.height / 2 - camera.y);
  ground(c, state);
  for (const b of state.world.buildings) if (visible(camera, b)) building(c, b);
  const list = getMissionMarkers(state);
  markers(c, state, list);
  // Vince is a permanent physical landmark even while a job is active.
  if (visible(camera, MISSION.contact)) {
    circle(c, MISSION.contact.x, MISSION.contact.y, 11, '#212945');
    circle(c, MISSION.contact.x + 2, MISSION.contact.y - 2, 6, '#dfb78b');
    text(c, 'VINCE', MISSION.contact.x, MISSION.contact.y + 23, 10, P.pink, 'center', 800);
  }
  for (const p of state.entities.pedestrians) if (visible(camera, p)) person(c, p, false, state.time);
  for (const carBody of state.entities.cars) if (visible(camera, carBody)) car(c, carBody, state.time);
  const player = state.entities.player;
  if (!player.vehicleId) {
    c.save();
    if (player.invulnerableFor > 0) c.globalAlpha = 0.6 + Math.sin(state.time * 32) * 0.25;
    person(c, player, true, state.time); c.restore();
    const ax = player.x + Math.cos(player.aimAngle) * 56, ay = player.y + Math.sin(player.aimAngle) * 56;
    c.strokeStyle = '#fff1c178'; c.lineWidth = 1; c.beginPath(); c.arc(ax, ay, 5, 0, TAU); c.stroke();
    line(c, ax - 8, ay, ax - 4, ay, P.text); line(c, ax + 4, ay, ax + 8, ay, P.text);
  }
  for (const b of state.entities.bullets) {
    const len = Math.hypot(b.vx, b.vy) || 1;
    line(c, b.x - b.vx / len * 14, b.y - b.vy / len * 14, b.x, b.y, P.gold, 2);
    circle(c, b.x, b.y, 2, P.text);
  }
  for (const e of state.effects) {
    if (e.remaining <= 0) continue;
    c.save(); c.globalAlpha = clamp(e.remaining * 4, 0, 1);
    if (e.kind === 'reward') {
      c.strokeStyle = P.neon; c.lineWidth = 3; c.beginPath(); c.arc(e.x, e.y, 16 + (1 - clamp(e.remaining, 0, 1)) * 45, 0, TAU); c.stroke();
    } else for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6 + hashSeed(e.id) % 9;
      line(c, e.x + Math.cos(a) * 3, e.y + Math.sin(a) * 3,
        e.x + Math.cos(a) * 17, e.y + Math.sin(a) * 17, e.kind === 'flash' ? P.gold : P.text, 2);
    }
    c.restore();
  }
  for (const p of state.world.palms) if (visible(camera, p)) palm(c, p, state.time);
  c.restore();
  const night = DAY_NIGHT.maxTint * (0.5 - 0.5 * Math.cos(state.dayPhase * TAU));
  c.save(); c.globalAlpha = clamp(night, 0, DAY_NIGHT.maxTint); box(c, 0, 0, VIEW.width, VIEW.height, P.night); c.restore();
  const o = objective(state);
  if (state.screen !== 'title') hud(c, state, list, o);
  overlay(renderer, state);
  c.restore();
  const announcement = `${GAME_TITLE}. ${state.screen}. ${o.title}. ${o.instruction}${o.packages ? `. ${o.packages}` : ''}${state.terminal && (state.screen === 'busted' || state.screen === 'wasted') ? `. ${state.terminal.reason}. Fine $${state.terminal.fine}. Press Enter to recover.` : ''}`;
  if (announcement !== renderer.lastAnnouncement) {
    renderer.lastAnnouncement = announcement;
    if (renderer.status) renderer.status.textContent = announcement;
  }
}

export function destroyRenderer(renderer) {
  if (renderer.destroyed) return;
  renderer.buttons.length = 0;
  renderer.status = null;
  renderer.destroyed = true;
}
