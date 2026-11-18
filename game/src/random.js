/** FNV-1a over UTF-16 code units, returning an unsigned 32-bit seed. */
export function hashSeed(str) {
  let hash = 2166136261;
  for (const character of String(str).split('')) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return hash >>> 0;
}

/** Mulberry32. Numeric seeds are coerced to uint32; string seeds are hashed. */
export function createRng(seed) {
  let state = typeof seed === 'string' ? hashSeed(seed) : Number(seed) >>> 0;
  return function rng() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform floating-point value in [min, max). */
export function range(rng, min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new RangeError('Invalid range');
  return min + rng() * (max - min);
}

/** Uniform integer in the inclusive interval [min, max]. */
export function int(rng, min, max) {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min || !Number.isSafeInteger(max - min + 1)) {
    throw new RangeError('Invalid integer range');
  }
  return Math.floor(range(rng, min, max + 1));
}

export function pick(rng, items) {
  if (items.length === 0) throw new RangeError('Cannot pick from an empty collection');
  return items[int(rng, 0, items.length - 1)];
}

/** Probability is clamped to [0, 1]; consumes one draw even at either endpoint. */
export function chance(rng, probability) {
  if (!Number.isFinite(probability)) throw new RangeError('Invalid probability');
  return rng() < Math.max(0, Math.min(1, probability));
}
