import { useLayoutEffect, useRef, useState } from 'react';
import { GRID_SIZE, cellCenter, progressToCell, yardSlots } from '../game/board';
import type { Color, GameState } from '../game/types';
import { reducedMotion } from './motion';

/** How long a token spends on each square it crosses. */
export const HOP_MS = 95;

/** How long a token takes to be thrown back to its yard after being taken. */
export const FLIGHT_MS = 520;

/** The longest walk a single move can make. More than this is a resync, not a
 *  move, and is snapped rather than acted out. */
const MAX_HOP = 6;

const UNIT = 100 / GRID_SIZE;

/** A position on the board, as a percentage of its width and height. */
export interface Spot {
  left: number;
  top: number;
}

/** Where a token stands at a given progress. Progress 0 is its yard slot. */
function spotFor(color: Color, slot: number, tokens: number, progress: number): Spot | null {
  const point =
    progress === 0 ? yardSlots(color, tokens)[slot] : cellCenterAt(color, progress);
  return point ? { left: point.col * UNIT, top: point.row * UNIT } : null;
}

function cellCenterAt(color: Color, progress: number) {
  const cell = progressToCell(color, progress);
  return cell ? cellCenter(cell) : null;
}

function progressMap(state: GameState): Map<string, number> {
  const map = new Map<string, number>();
  for (const player of state.players) {
    for (const token of player.tokens) map.set(token.id, token.progress);
  }
  return map;
}

interface Walker {
  id: string;
  color: Color;
  slot: number;
  tokens: number;
  from: number;
  steps: number;
}

/** The one token that moved forward, if any. Only ever one per move. */
function findWalker(
  state: GameState,
  before: Map<string, number>,
  now: Map<string, number>,
): Walker | null {
  for (const player of state.players) {
    for (const [slot, token] of player.tokens.entries()) {
      const was = before.get(token.id);
      const is = now.get(token.id);
      if (was === undefined || is === undefined) continue;
      const steps = is - was;
      if (steps > 0 && steps <= MAX_HOP) {
        return {
          id: token.id,
          color: player.color,
          slot,
          tokens: player.tokens.length,
          from: was,
          steps,
        };
      }
    }
  }
  return null;
}

/** What the board needs to draw a move as it happens rather than after it. */
export interface Travel {
  /** Positions overriding the ones the state implies, for tokens mid-walk. */
  spots: Map<string, Spot>;
  /** Tokens being thrown back to their yard right now, having just been taken. */
  returning: Set<string>;
}

/**
 * Walks a token square by square instead of letting it slide straight to its
 * destination, and reports each square as it is crossed.
 *
 * A token that gets taken waits where it stood until the token taking it
 * arrives, and is then released to fly back to its yard — so a capture is a
 * collision followed by a journey home, rather than one token vanishing while
 * another is still halfway across the board.
 *
 * `onArrive` fires once per state version, immediately when there is nothing to
 * act out. That makes it the single point where a version has finished playing,
 * which is what the sound cues hang off — a capture should be heard when the
 * tokens collide, not when the write lands.
 */
export function useTokenTravel(
  state: GameState,
  onStep: () => void,
  onArrive: () => void,
): Travel {
  const [spots, setSpots] = useState<Map<string, Spot>>(() => new Map());
  const [returning, setReturning] = useState<Set<string>>(() => new Set());
  // Held in a ref so a new closure each render never restarts a walk.
  const handlers = useRef({ onStep, onArrive });
  handlers.current = { onStep, onArrive };
  const previous = useRef<Map<string, number>>(progressMap(state));
  const seen = useRef(state.version);

  useLayoutEffect(() => {
    if (state.version === seen.current) return;
    seen.current = state.version;

    const now = progressMap(state);
    const before = previous.current;
    previous.current = now;

    // Everything that was on the board a moment ago and is back in a yard now.
    const struck = new Map<string, Spot>();
    for (const player of state.players) {
      for (const [slot, token] of player.tokens.entries()) {
        const was = before.get(token.id) ?? 0;
        if (was > 0 && now.get(token.id) === 0) {
          const spot = spotFor(player.color, slot, player.tokens.length, was);
          if (spot) struck.set(token.id, spot);
        }
      }
    }

    const walker = findWalker(state, before, now);
    const calm = reducedMotion();

    /** Release the struck tokens and let them fly home. */
    const sendHome = () => {
      setSpots(new Map());
      if (calm || struck.size === 0) {
        setReturning(new Set());
        return undefined;
      }
      setReturning(new Set(struck.keys()));
      return window.setTimeout(() => setReturning(new Set()), FLIGHT_MS);
    };

    if (!walker || calm) {
      const flight = sendHome();
      handlers.current.onArrive();
      return () => clearTimeout(flight);
    }

    const at = (progress: number) => {
      const next = new Map(struck);
      const spot = spotFor(walker.color, walker.slot, walker.tokens, progress);
      if (spot) next.set(walker.id, spot);
      return next;
    };

    // Start the walk from where the token already is. Applied in a layout
    // effect, so it lands before the browser paints the destination.
    setSpots(at(walker.from));

    let step = 0;
    let flight: number | undefined;
    const timer = setInterval(() => {
      step += 1;
      setSpots(at(walker.from + step));
      handlers.current.onStep();
      if (step >= walker.steps) {
        clearInterval(timer);
        flight = sendHome();
        handlers.current.onArrive();
      }
    }, HOP_MS);

    return () => {
      clearInterval(timer);
      clearTimeout(flight);
    };
  }, [state]);

  return { spots, returning };
}
