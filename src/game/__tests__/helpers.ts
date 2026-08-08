import { rollDie } from '../rng';
import type { Color, GameState } from '../types';
import { createGame } from '../engine';

/**
 * Find a seed whose successive rolls are exactly `values`. The PRNG is
 * deterministic, so this pins dice outcomes in tests without mocking anything.
 */
export function findSeed(values: number[], limit = 2_000_000): number {
  for (let seed = 1; seed < limit; seed++) {
    let s = seed;
    let ok = true;
    for (const want of values) {
      const roll = rollDie(s);
      if (roll.value !== want) {
        ok = false;
        break;
      }
      s = roll.nextSeed;
    }
    if (ok) return seed;
  }
  throw new Error(`No seed within ${limit} produces the rolls ${values.join(',')}`);
}

/** A game with token positions forced, for testing rules in isolation. */
export function gameWith(
  colors: Color[],
  positions: Record<string, number>,
  overrides: Partial<GameState> = {},
): GameState {
  const base = createGame(colors, [], 1);
  return {
    ...base,
    players: base.players.map((p) => ({
      ...p,
      tokens: p.tokens.map((t) =>
        t.id in positions ? { ...t, progress: positions[t.id] } : t,
      ),
    })),
    ...overrides,
  };
}

/** Force a state into "a roll of `dice` has happened, now choose a move". */
export function awaitingMove(state: GameState, dice: number): GameState {
  return { ...state, phase: 'awaiting-move', dice };
}

export function progressOf(state: GameState, tokenId: string): number {
  for (const p of state.players) {
    const t = p.tokens.find((x) => x.id === tokenId);
    if (t) return t.progress;
  }
  throw new Error(`No token ${tokenId}`);
}
