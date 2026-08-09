/**
 * The rules engine. Every function here is pure: it takes a GameState and
 * returns a new one, never mutating the input and never touching I/O. This is
 * what makes the same code safe to run on the current player's client and to
 * unit-test exhaustively.
 */

import {
  DEFAULT_TOKEN_COUNT,
  FINISH,
  HOME_COLUMN_START,
  MAIN_TRACK_STEPS,
  TOKEN_COUNTS,
  YARD,
  absoluteTrackIndex,
  isSafeIndex,
} from './board';
import { randomSeed, rollDie } from './rng';
import type { Color, GameEvent, GameState, Move, Player, Token } from './types';
import { COLORS } from './types';

export const MAX_CONSECUTIVE_SIXES = 3;

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Start a new game. `colors` must be 2..4 distinct colors; they are seated in
 * clockwise track order regardless of the order given. Every player gets the
 * same number of tokens — the table agrees on it before the first roll, and
 * nothing afterwards reads it back off a setting: the token list itself is the
 * record, so a state read from the database needs no extra field to be complete.
 */
export function createGame(
  colors: Color[],
  names: string[] = [],
  seed: number = randomSeed(),
  tokenCount: number = DEFAULT_TOKEN_COUNT,
): GameState {
  if (colors.length < 2 || colors.length > 4) {
    throw new Error(`A game needs 2 to 4 players, got ${colors.length}`);
  }
  if (new Set(colors).size !== colors.length) {
    throw new Error('Each player must have a distinct color');
  }
  if (!TOKEN_COUNTS.includes(tokenCount)) {
    throw new Error(`Tokens per player must be one of ${TOKEN_COUNTS.join(', ')}`);
  }

  const seated = COLORS.filter((c) => colors.includes(c));

  const players: Player[] = seated.map((color) => ({
    color,
    name: names[colors.indexOf(color)] ?? capitalize(color),
    tokens: makeTokens(color, tokenCount),
    finished: false,
  }));

  return {
    players,
    turnIndex: 0,
    phase: 'awaiting-roll',
    dice: [],
    lastRoll: [],
    consecutiveSixes: 0,
    bonusRolls: 0,
    winnerOrder: [],
    rngSeed: seed,
    lastEvent: null,
    version: 0,
  };
}

function makeTokens(color: Color, count: number): Token[] {
  return Array.from({ length: count }, (_, i) => ({
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
 * Every legal move for the current player, across every number still held.
 * Empty unless the state is awaiting a move.
 */
export function getLegalMoves(state: GameState): Move[] {
  if (state.phase !== 'awaiting-move') return [];
  return legalMovesFor(state, state.turnIndex, state.dice);
}

function legalMovesFor(state: GameState, turnIndex: number, dice: number[]): Move[] {
  const player = state.players[turnIndex];
  const moves: Move[] = [];
  // Held numbers are deduplicated: two sixes offer the same moves as one, and
  // spending either leaves the same state, so listing both only doubles up.
  for (const die of new Set(dice)) {
    for (const token of player.tokens) {
      const move = resolveMove(state, player, token, die);
      if (move) moves.push(move);
    }
  }
  return moves;
}

/** A copy of `dice` with one occurrence of `die` removed. */
function spend(dice: number[], die: number): number[] {
  const at = dice.indexOf(die);
  return at === -1 ? [...dice] : [...dice.slice(0, at), ...dice.slice(at + 1)];
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

  return {
    tokenId: token.id,
    die: dice,
    from: token.progress,
    to,
    kind,
    captures: capturesAt(state, player.color, to),
  };
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
 * Roll for the current player.
 *
 * A six is not played immediately: it is held and rolled on top of, so the
 * player finishes rolling with every number in hand and decides afterwards how
 * to spend them. Rolling only stops on a number other than six, or on the third
 * six — which still forfeits the whole turn, held numbers and all.
 */
export function rollDice(state: GameState): GameState {
  if (state.phase !== 'awaiting-roll') {
    throw new Error(`Cannot roll while phase is "${state.phase}"`);
  }

  const { value, nextSeed } = rollDie(state.rngSeed);
  const color = currentTurn(state).color;
  const sixes = value === 6 ? state.consecutiveSixes + 1 : 0;
  const held = [...state.dice, value];
  const opening = state.dice.length === 0;
  // Anything already held means this is a re-roll within the same turn, so the
  // display accumulates; otherwise the turn starts a fresh row of dice.
  const rolled = opening ? [value] : [...state.lastRoll, value];
  // lastRoll is set on every branch, including the ones that hand the turn on,
  // so what was actually rolled stays on screen.
  const base = {
    ...state,
    rngSeed: nextSeed,
    lastRoll: rolled,
    version: state.version + 1,
    // An owed roll is only spent when a fresh sequence opens; rolling on top of
    // a held six is part of the same one.
    bonusRolls: opening && state.bonusRolls > 0 ? state.bonusRolls - 1 : state.bonusRolls,
  };

  // Three sixes in one turn: nothing held is ever played.
  if (sixes === MAX_CONSECUTIVE_SIXES) {
    return passTurn(base, { type: 'threeSixes', color });
  }

  if (value === 6) {
    return {
      ...base,
      phase: 'awaiting-roll',
      dice: held,
      consecutiveSixes: sixes,
      lastEvent: { type: 'rolled', color, value },
    };
  }

  if (legalMovesFor(state, state.turnIndex, held).length === 0) {
    return passTurn(base, { type: 'noLegalMove', color, values: held });
  }

  return {
    ...base,
    phase: 'awaiting-move',
    dice: held,
    consecutiveSixes: sixes,
    lastEvent: { type: 'rolled', color, value },
  };
}

/**
 * Apply the current player's chosen move: this token, spending this number.
 *
 * `die` may be left out only when the token can be moved by exactly one of the
 * held numbers. With a real choice on the table, guessing on the player's behalf
 * would throw away the move they meant to make.
 */
export function applyMove(state: GameState, tokenId: string, die?: number): GameState {
  if (state.phase !== 'awaiting-move') {
    throw new Error(`Cannot move while phase is "${state.phase}"`);
  }
  const forToken = getLegalMoves(state).filter(
    (m) => m.tokenId === tokenId && (die === undefined || m.die === die),
  );
  if (forToken.length === 0) {
    throw new Error(
      `No legal move for token "${tokenId}"` +
        (die === undefined ? ` with ${state.dice.join(' or ')}` : ` using ${die}`),
    );
  }
  if (forToken.length > 1) {
    throw new Error(
      `Token "${tokenId}" can be moved by ${forToken
        .map((m) => m.die)
        .join(' or ')} — say which`,
    );
  }
  const move = forToken[0];

  const mover = currentTurn(state);
  const captured = new Set(move.captures);
  const remaining = spend(state.dice, move.die);

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
    dice: remaining,
    // Two ways to earn another roll: send an opponent home, or bring one of
    // your own all the way in. Both are taken once the hand is empty. They
    // cannot happen on the same move — the center is not a capturable square —
    // but the sum keeps that an observation rather than an assumption.
    bonusRolls:
      state.bonusRolls + (move.captures.length > 0 ? 1 : 0) + (move.kind === 'finish' ? 1 : 0),
  };

  if (isGameOver(next)) {
    return { ...next, phase: 'game-over', dice: [], consecutiveSixes: 0, bonusRolls: 0 };
  }

  // Play on while numbers are still held and any of them can be used. A player
  // whose last token just came home has nothing left to move them with.
  if (
    !justFinished &&
    remaining.length > 0 &&
    legalMovesFor(next, moverIndex, remaining).length > 0
  ) {
    return { ...next, phase: 'awaiting-move' };
  }

  // The hand is spent. An earned roll keeps the turn with the same player, on a
  // clean sheet — the six counter belongs to the sequence just finished.
  if (!justFinished && next.bonusRolls > 0) {
    return { ...next, phase: 'awaiting-roll', dice: [], consecutiveSixes: 0 };
  }

  return {
    ...next,
    phase: 'awaiting-roll',
    dice: [],
    turnIndex: nextTurnIndex(next, moverIndex),
    consecutiveSixes: 0,
    bonusRolls: 0,
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
    dice: [],
    consecutiveSixes: 0,
    // A turn that is handed on takes nothing with it, earned rolls included.
    bonusRolls: 0,
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
