/**
 * A tiny deterministic PRNG (mulberry32). The seed is a single 32-bit integer
 * kept inside GameState, which keeps state serializable and makes every test
 * reproducible. Pure: takes a seed, returns a value plus the next seed.
 */

export interface RollResult {
  value: number;
  nextSeed: number;
}

/** Advance the seed and return a float in [0, 1) along with the new seed. */
export function nextRandom(seed: number): { value: number; nextSeed: number } {
  let t = (seed + 0x6d2b79f5) | 0;
  const s = t;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, nextSeed: s };
}

/** Roll a fair six-sided die. */
export function rollDie(seed: number): RollResult {
  const { value, nextSeed } = nextRandom(seed);
  return { value: Math.floor(value * 6) + 1, nextSeed };
}

/** A seed for a fresh game, when the caller does not supply one. */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) | 0;
}
