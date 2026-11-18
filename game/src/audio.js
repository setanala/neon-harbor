import { AUDIO } from './config.js';

const internals = new WeakMap();
const MAX_VOICES = 24;

export function createAudio() {
  const audio = { context: null, master: null, muted: false, unlocked: false,
    engine: null, siren: null };
  const data = { voices: new Set(), destroyed: false, silent: false, gesture: false, listeners: null };
  internals.set(audio, data);
  if (typeof window !== 'undefined') {
    const gesture = event => {
      if (!event.isTrusted) return;
      data.gesture = true;
      void unlockAudio(audio);
      data.gesture = false;
    };
    data.listeners = gesture;
    window.addEventListener('keydown', gesture);
    window.addEventListener('pointerdown', gesture);
  }
  return audio;
}

function removeListeners(data) {
  if (!data.listeners || typeof window === 'undefined') return;
  window.removeEventListener('keydown', data.listeners);
  window.removeEventListener('pointerdown', data.listeners);
  data.listeners = null;
}

export async function unlockAudio(audio) {
  const data = internals.get(audio);
  if (!data || data.destroyed || data.silent) return;
  const active = typeof navigator !== 'undefined' && navigator.userActivation?.isActive;
  if (!data.gesture && !active) return;
  try {
    if (!audio.context) {
      const Constructor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Constructor) return;
      audio.context = new Constructor();
      audio.master = audio.context.createGain();
      audio.master.gain.value = audio.muted ? 0 : AUDIO.masterVolume;
      audio.master.connect(audio.context.destination);
    }
    if (audio.context.state === 'suspended') await audio.context.resume();
    if (data.destroyed) return;
    audio.unlocked = audio.context.state === 'running';
    if (audio.unlocked) removeListeners(data);
  } catch {
    audio.unlocked = false;
  }
}

function dispose(voice) {
  if (voice.done) return;
  voice.done = true;
  for (const source of voice.sources) {
    source.onended = null;
    try { source.stop(); } catch { /* Already stopped. */ }
  }
  for (const node of voice.nodes) node.disconnect();
  voice.voices.delete(voice);
}

function voice(audio) {
  const voices = internals.get(audio).voices;
  if (voices.size >= MAX_VOICES) {
    dispose([...voices].find(item => !item.oscillator) || voices.values().next().value);
  }
  const result = { sources: [], nodes: [], voices, done: false };
  voices.add(result);
  return result;
}

function tone(audio, frequency, endFrequency, delay, duration, volume, type = 'sine', noise = false) {
  const context = audio.context;
  const v = voice(audio);
  const source = noise ? context.createBufferSource() : context.createOscillator();
  const gain = context.createGain();
  const start = context.currentTime + delay;
  if (noise) {
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const samples = buffer.getChannelData(0);
    // Local deterministic noise never consumes any gameplay randomness.
    let seed = 0x6d2b79f5;
    for (let i = 0; i < samples.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      samples[i] = (seed >>> 0) / 2147483648 - 1;
    }
    source.buffer = buffer;
  } else {
    source.type = type;
    source.frequency.setValueAtTime(frequency, start);
    source.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), start + duration);
  }
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + Math.min(0.006, duration / 4));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(gain); gain.connect(audio.master);
  v.sources.push(source); v.nodes.push(source, gain);
  source.onended = () => dispose(v);
  source.start(start); source.stop(start + duration + 0.01);
}

export function playSound(audio, name) {
  const data = internals.get(audio);
  if (!data || data.destroyed || data.silent || audio.muted || !audio.unlocked || audio.context?.state !== 'running') return;
  const note = (hz, end, delay, length, volume, type, noise) => tone(audio, hz, end, delay, length, volume, type, noise);
  switch (name) {
    case 'shot':
      note(160, 42, 0, 0.12, 0.65, 'triangle');
      note(0, 0, 0, 0.09, 0.65, 'sine', true); break;
    case 'impact':
      note(95, 28, 0, 0.18, 0.5, 'sine');
      note(0, 0, 0, 0.12, 0.32, 'sine', true); break;
    case 'pickup':
      [660, 880, 1320].forEach((hz, i) => note(hz, hz, i * 0.065, 0.18, 0.25)); break;
    case 'reward':
      [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) => note(hz, hz, i * 0.12, i === 3 ? 0.5 : 0.24, 0.3, 'triangle')); break;
    case 'busted':
      [392, 311, 261, 196].forEach((hz, i) => note(hz, hz * 0.9, i * 0.17, 0.3, 0.28, 'triangle')); break;
    case 'wasted':
      note(220, 38, 0, 0.9, 0.45, 'triangle');
      note(0, 0, 0, 0.5, 0.18, 'sine', true); break;
    case 'click': note(720, 480, 0, 0.045, 0.2, 'triangle'); break;
  }
}

function stopLoop(audio, key) {
  if (!audio[key]) return;
  dispose(audio[key]);
  audio[key] = null;
}

function loop(audio, key, type, volume) {
  if (audio[key] && !audio[key].done) return audio[key];
  const v = voice(audio);
  const oscillator = audio.context.createOscillator();
  const gain = audio.context.createGain();
  oscillator.type = type;
  gain.gain.value = volume;
  oscillator.connect(gain); gain.connect(audio.master);
  v.sources.push(oscillator); v.nodes.push(oscillator, gain);
  v.oscillator = oscillator;
  oscillator.start();
  audio[key] = v;
  return v;
}

export function updateAudio(audio, state, dt) {
  const data = internals.get(audio);
  if (!data || data.destroyed) return;
  data.silent = Boolean(state.shot);
  setAudioMuted(audio, Boolean(state.settings.muted));
  const running = !data.silent && !audio.muted && audio.unlocked && audio.context?.state === 'running' && state.screen === 'play';
  if (!running) {
    stopLoop(audio, 'engine'); stopLoop(audio, 'siren');
    for (const v of [...data.voices]) dispose(v);
    return;
  }
  const car = state.entities.cars.find(item => item.id === state.entities.player.vehicleId && !item.destroyed);
  const now = audio.context.currentTime;
  const smoothing = Math.max(0.015, Math.min(0.1, Number.isFinite(dt) ? dt : 0.03));
  if (car) {
    const engine = loop(audio, 'engine', 'sawtooth', AUDIO.engineVolume);
    engine.oscillator.frequency.setTargetAtTime(38 + Math.min(500, Math.abs(car.speed)) * 0.34, now, smoothing);
  } else stopLoop(audio, 'engine');
  if (state.wanted.stars > 0 && state.entities.cars.some(item => item.kind === 'police' && !item.destroyed)) {
    const siren = loop(audio, 'siren', 'sine', AUDIO.sirenVolume);
    siren.oscillator.frequency.setTargetAtTime(Math.floor(state.time / 0.32) % 2 ? 960 : 640, now, 0.025);
  } else stopLoop(audio, 'siren');
}

export function setAudioMuted(audio, muted) {
  const data = internals.get(audio);
  if (!data || data.destroyed) return;
  audio.muted = Boolean(muted);
  if (audio.master) audio.master.gain.setValueAtTime(audio.muted || data.silent ? 0 : AUDIO.masterVolume, audio.context.currentTime);
  if (audio.muted) {
    stopLoop(audio, 'engine'); stopLoop(audio, 'siren');
    for (const v of [...data.voices]) dispose(v);
  }
}

export function destroyAudio(audio) {
  const data = internals.get(audio);
  if (!data || data.destroyed) return;
  data.destroyed = true;
  removeListeners(data);
  stopLoop(audio, 'engine'); stopLoop(audio, 'siren');
  for (const v of [...data.voices]) dispose(v);
  if (audio.master) audio.master.disconnect();
  if (audio.context && audio.context.state !== 'closed') void audio.context.close().catch(() => {});
  audio.context = null; audio.master = null; audio.unlocked = false;
}
