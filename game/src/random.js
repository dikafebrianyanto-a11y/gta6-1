// Seeded randomness for Solmar.
//
// One tiny generator, one stream of helpers. The city, the traffic and the
// missions all draw from the same stream, so a given seed always builds the
// same city — and the screenshot scenes always play back the same way.
//
// Everything here is deterministic: no Math.random, no Date.now. Hand a
// helper a generator and it returns the same sequence every run.

const UINT32 = 4294967296;
const SEED_STEP = 0x6d2b79f5;

/**
 * mulberry32, written as a small state machine.
 *
 * Tiny, fast, and plenty random enough for a city generator. `seed` is
 * coerced to an unsigned 32-bit integer, and every call to the returned
 * function advances the state by one step and yields a float in [0, 1).
 */
export function makeRng(seed) {
  let state = seed >>> 0;

  return function nextFloat() {
    state = (state + SEED_STEP) | 0;
    let scrambled = state;
    scrambled = Math.imul(scrambled ^ (scrambled >>> 15), 1 | scrambled);
    scrambled = (scrambled + Math.imul(scrambled ^ (scrambled >>> 7), 61 | scrambled)) ^ scrambled;
    return ((scrambled ^ (scrambled >>> 14)) >>> 0) / UINT32;
  };
}

/**
 * Pick one entry from a weighted list, using a supplied draw function.
 *
 * `entries` is an array of [value, weight] pairs; a heavier weight means a
 * proportionally bigger slice of the [0, total) roll. Entries with a weight
 * of zero or less never win. When the list is empty, or every weight is
 * zero, the result is undefined. The draw function is injected (usually a
 * `makeRng` result) so the pick stays deterministic and testable.
 */
export function weightedPick(draw, entries) {
  let total = 0;
  for (const [, weight] of entries) {
    if (weight > 0) total += weight;
  }
  if (total <= 0) return undefined;

  let roll = draw() * total;
  for (const [value, weight] of entries) {
    if (weight <= 0) continue;
    roll -= weight;
    if (roll < 0) return value;
  }
  // Floating-point rounding can leave the roll just above zero after the
  // last entry; the last positive entry wins in that case.
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i][1] > 0) return entries[i][0];
  }
  return undefined;
}

/**
 * A bundle of draws over a single generator, so call sites read plainly.
 *
 * Every method below consumes from the same `next` stream, in call order.
 * Two kits built from the same seed therefore produce the same sequence,
 * draw for draw, which is what makes a seeded city reproducible.
 */
export function rngKit(seed) {
  const next = makeRng(seed);

  // Fisher-Yates, done on a copy so the caller's array is never reordered.
  function shuffledCopy(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      const held = out[i];
      out[i] = out[j];
      out[j] = held;
    }
    return out;
  }

  return {
    next,

    /** One element of a non-empty array, uniformly at random. */
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },

    /** A weighted pick from [value, weight] pairs; see weightedPick. */
    weighted(entries) {
      return weightedPick(next, entries);
    },

    /** Float in [min, max). */
    range(min, max) {
      return min + next() * (max - min);
    },

    /** Integer in [min, max], both ends inclusive. */
    int(min, max) {
      return Math.floor(min + next() * (max - min + 1));
    },

    /** True with probability p, where p is in 0..1. */
    chance(p) {
      return next() < p;
    },

    /** A shuffled copy of the array; the original is left untouched. */
    shuffle(list) {
      return shuffledCopy(list);
    },

    /**
     * A roughly bell-shaped value around 0, in [-1, 1].
     * The average of three draws, rescaled, so middling values are common
     * and extremes are rare — good for a natural-looking scatter.
     */
    bell() {
      return (next() + next() + next() - 1.5) / 1.5;
    },
  };
}

/**
 * Turn an arbitrary string into a stable 32-bit seed (FNV-1a).
 *
 * The same text always hashes to the same seed, so a named city or a
 * mission id can double as its seed without keeping a lookup table.
 */
export function seedFromText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
