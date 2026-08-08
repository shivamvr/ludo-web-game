/**
 * The rules engine. Every function here is pure: it takes a GameState and
 * returns a new one, never mutating the input and never touching I/O. This is
 * what makes the same code safe to run on the current player's client and to
 * unit-test exhaustively.
 */

import {
  FINISH,
  HOME_COLUMN_START,
  MAIN_TRACK_STEPS,
  YARD,
  absoluteTrackIndex,
  isSafeIndex,
} from './board';
import { randomSeed, rollDie } from './rng';
import type { Color, GameEvent, GameState, Move, Player, Token } from './types';
import { COLORS } from './types';

export const MAX_CONSECUTIVE_SIXES = 3;
const TOKENS_PER_PLAYER = 4;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Start a new game. `colors` must be 2..4 distinct colors; they are seated in
 * clockwise track order regardless of the order given.
 */
export function createGame(
  colors: Color[],
  names: string[] = [],
  seed: number = randomSeed(),
): GameState {
  if (colors.length < 2 || colors.length > 4) {
    throw new Error(`A game needs 2 to 4 players, got ${colors.length}`);
  }
  if (new Set(colors).size !== colors.length) {
    throw new Error('Each player must have a distinct color');
  }

  const seated = COLORS.filter((c) => colors.includes(c));

  const players: Player[] = seated.map((color) => ({
    color,
    name: names[colors.indexOf(color)] ?? capitalize(color),
    tokens: makeTokens(color),
    finished: false,
  }));

  return {
    players,
    turnIndex: 0,
    phase: 'awaiting-roll',
    dice: null,
    lastRoll: null,
    consecutiveSixes: 0,
    winnerOrder: [],
    rngSeed: seed,
    lastEvent: null,
    version: 0,
  };
}

function makeTokens(color: Color): Token[] {
  return Array.from({ length: TOKENS_PER_PLAYER }, (_, i) => ({
    id: `${color}-${i}`,
    color,
    progress: YARD,
  }));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function currentTurn(state: GameState): Player {
  return state.players[state.turnIndex];
}

export function isGameOver(state: GameState): boolean {
  // The game ends when only one player is still racing — the last one left does
  // not need to play out their remaining tokens.
  return state.winnerOrder.length >= state.players.length - 1;
}

/** Finish order, first place first. Empty until someone brings all 4 home. */
export function standings(state: GameState): Color[] {
  if (!isGameOver(state)) return [...state.winnerOrder];
  const last = state.players.find((p) => !state.winnerOrder.includes(p.color));
  return last ? [...state.winnerOrder, last.color] : [...state.winnerOrder];
}

/**
 * Every legal move for the current player with the current roll. Empty unless
 * the state is awaiting a move.
 */
export function getLegalMoves(state: GameState): Move[] {
  if (state.phase !== 'awaiting-move' || state.dice === null) return [];
  return legalMovesFor(state, state.turnIndex, state.dice);
}

function legalMovesFor(state: GameState, turnIndex: number, dice: number): Move[] {
  const player = state.players[turnIndex];
  const moves: Move[] = [];
  for (const token of player.tokens) {
    const move = resolveMove(state, player, token, dice);
    if (move) moves.push(move);
  }
  return moves;
}

/**
 * Resolve one token's move for a roll, or null if it is illegal. This is the
 * single place the movement rules live.
 */
function resolveMove(
  state: GameState,
  player: Player,
  token: Token,
  dice: number,
): Move | null {
  if (token.progress === FINISH) return null;

  let to: number;
  let kind: Move['kind'];

  if (token.progress === YARD) {
    // Only a 6 opens the yard, and it lands exactly on the start square.
    if (dice !== 6) return null;
    to = 1;
    kind = 'leaveHome';
  } else {
    to = token.progress + dice;
    // Exact count to finish: an overshoot cannot move this token at all.
    if (to > FINISH) return null;
    kind = to === FINISH ? 'finish' : 'advance';
  }

  // Own tokens block, except at the center where all four end up together.
  if (to !== FINISH && player.tokens.some((t) => t.id !== token.id && t.progress === to)) {
    return null;
  }

  return { tokenId: token.id, from: token.progress, to, kind, captures: capturesAt(state, player.color, to) };
}

/** Opponent tokens sent home by landing on `to`. Empty off the shared track. */
function capturesAt(state: GameState, color: Color, to: number): string[] {
  if (to < 1 || to > MAIN_TRACK_STEPS) return [];
  const target = absoluteTrackIndex(color, to)!;
  // Nothing can be captured on a start or star square.
  if (isSafeIndex(target)) return [];

  const captured: string[] = [];
  for (const other of state.players) {
    if (other.color === color) continue;
    for (const token of other.tokens) {
      if (absoluteTrackIndex(other.color, token.progress) === target) {
        captured.push(token.id);
      }
    }
  }
  return captured;
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Roll for the current player. Resolves everything that needs no decision:
 * a third consecutive six forfeits the turn, and a roll with no legal move
 * passes (or, on a six, re-rolls). Otherwise the state lands in 'awaiting-move'.
 */
export function rollDice(state: GameState): GameState {
  if (state.phase !== 'awaiting-roll') {
    throw new Error(`Cannot roll while phase is "${state.phase}"`);
  }

  const { value, nextSeed } = rollDie(state.rngSeed);
  const color = currentTurn(state).color;
  const sixes = value === 6 ? state.consecutiveSixes + 1 : 0;
  // lastRoll is set on every branch, including the ones that hand the turn on,
  // so the face that was actually rolled stays on screen.
  const base = { ...state, rngSeed: nextSeed, lastRoll: value, version: state.version + 1 };

  // Three sixes in one turn: the third roll's move is never applied.
  if (sixes === MAX_CONSECUTIVE_SIXES) {
    return passTurn(base, { type: 'threeSixes', color });
  }

  const moves = legalMovesFor(state, state.turnIndex, value);

  if (moves.length === 0) {
    const event: GameEvent = { type: 'noLegalMove', color, value };
    // A six still buys another roll even when it cannot be used.
    if (value === 6) {
      return { ...base, phase: 'awaiting-roll', dice: null, consecutiveSixes: sixes, lastEvent: event };
    }
    return passTurn(base, event);
  }

  return {
    ...base,
    phase: 'awaiting-move',
    dice: value,
    consecutiveSixes: sixes,
    lastEvent: { type: 'rolled', color, value },
  };
}

/**
 * Apply the current player's chosen move. `tokenId` must name a token with a
 * legal move for the current roll.
 */
export function applyMove(state: GameState, tokenId: string): GameState {
  if (state.phase !== 'awaiting-move') {
    throw new Error(`Cannot move while phase is "${state.phase}"`);
  }
  const move = getLegalMoves(state).find((m) => m.tokenId === tokenId);
  if (!move) {
    throw new Error(`No legal move for token "${tokenId}" with a roll of ${state.dice}`);
  }

  const mover = currentTurn(state);
  const captured = new Set(move.captures);

  const players = state.players.map((player) => {
    const tokens = player.tokens.map((token) => {
      if (token.id === move.tokenId) return { ...token, progress: move.to };
      if (captured.has(token.id)) return { ...token, progress: YARD };
      return token;
    });
    return { ...player, tokens, finished: tokens.every((t) => t.progress === FINISH) };
  });

  const moverIndex = state.turnIndex;
  const justFinished = players[moverIndex].finished && !state.players[moverIndex].finished;
  const winnerOrder = justFinished ? [...state.winnerOrder, mover.color] : state.winnerOrder;

  const next: GameState = {
    ...state,
    players,
    winnerOrder,
    version: state.version + 1,
    lastEvent: describe(move, mover.color, justFinished, winnerOrder),
    dice: null,
  };

  if (isGameOver(next)) {
    return { ...next, phase: 'game-over', consecutiveSixes: 0 };
  }

  // Rolling a six earns another roll — unless that move just brought the
  // player's last token home, in which case there is nothing left to move.
  if (state.dice === 6 && !justFinished) {
    return { ...next, phase: 'awaiting-roll' };
  }

  return {
    ...next,
    phase: 'awaiting-roll',
    turnIndex: nextTurnIndex(next, moverIndex),
    consecutiveSixes: 0,
  };
}

/**
 * Pass the turn without playing it. Used when the player whose turn it is has
 * disconnected — the rules themselves never skip a turn, so this is only ever
 * driven from outside by the presence watchdog.
 */
export function skipTurn(state: GameState): GameState {
  if (state.phase === 'game-over') {
    throw new Error('Cannot skip a turn after the game is over');
  }
  const color = currentTurn(state).color;
  return passTurn(
    { ...state, version: state.version + 1 },
    { type: 'skipped', color },
  );
}

function describe(
  move: Move,
  color: Color,
  justFinished: boolean,
  winnerOrder: Color[],
): GameEvent {
  if (justFinished) return { type: 'playerWon', color, place: winnerOrder.length };
  if (move.captures.length > 0) return { type: 'captured', by: color, tokenIds: move.captures };
  if (move.kind === 'finish') return { type: 'finishedToken', color, tokenId: move.tokenId };
  return { type: 'moved', color, move };
}

/** Hand the turn to the next player still racing. */
function passTurn(state: GameState, event: GameEvent): GameState {
  return {
    ...state,
    phase: 'awaiting-roll',
    dice: null,
    consecutiveSixes: 0,
    turnIndex: nextTurnIndex(state, state.turnIndex),
    lastEvent: event,
  };
}

function nextTurnIndex(state: GameState, from: number): number {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const index = (from + step) % n;
    if (!state.players[index].finished) return index;
  }
  return from;
}

// ---------------------------------------------------------------------------
// Helpers shared with the UI
// ---------------------------------------------------------------------------

/** True once a token has left the shared track for its home column or center. */
export function isHomeBound(progress: number): boolean {
  return progress >= HOME_COLUMN_START;
}

export function findToken(state: GameState, tokenId: string): Token | undefined {
  for (const player of state.players) {
    const token = player.tokens.find((t) => t.id === tokenId);
    if (token) return token;
  }
  return undefined;
}
