// Seeded randomness for Solmar: one small generator, one stream of helpers.
// The city, traffic and missions all draw from it, so the same seed always
// builds the same city and the same screenshot scenes always play the same.

/** mulberry32: tiny, fast, and good enough for a city generator. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A bundle of draws over one generator, so call sites read plainly. */
export function rngKit(seed) {
  const next = makeRng(seed);
  return {
    next,
    /** Float in [min, max). */
    range(min, max) {
      return min + next() * (max - min);
    },
    /** Integer in [min, max] inclusive. */
    int(min, max) {
      return Math.floor(min + next() * (max - min + 1));
    },
    /** True with probability p (0..1). */
    chance(p) {
      return next() < p;
    },
    /** One element of a non-empty array. */
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    /** A shuffled copy of the array. */
    shuffle(list) {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    },
    /** A roughly bell-shaped value around 0, in [-1, 1]. */
    bell() {
      return (next() + next() + next() - 1.5) / 1.5;
    },
  };
}

/** Turn an arbitrary string into a stable 32-bit seed. */
export function seedFromText(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
