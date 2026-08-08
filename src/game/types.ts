/**
 * Shared game types. Imported by the pure engine, the UI, and (from Phase 2) the
 * Firebase data layer. Everything here is plain JSON — no class instances, no
 * Maps/Sets, no undefined-only fields — so a whole GameState can be written to
 * Firebase Realtime Database verbatim.
 */

export type Color = 'red' | 'green' | 'yellow' | 'blue';

/** Seat order around the board, clockwise. Also the turn order. */
export const COLORS: readonly Color[] = ['red', 'green', 'yellow', 'blue'];

/**
 * A token's position along its own path, as a single integer.
 *
 *   0        in the yard (not yet on the board)
 *   1..51    on the shared 52-square main track
 *   52..57   in this player's own 6-square colored home column
 *   58       the center square — finished
 *
 * `board.ts` turns (color, progress) into a grid coordinate; the rules never
 * touch coordinates.
 */
export type Progress = number;

export interface Token {
  /** `${color}-${index}`, e.g. "red-0". Unique across the whole game. */
  id: string;
  color: Color;
  progress: Progress;
}

export interface Player {
  /** The seat identity. Two players never share a color. */
  color: Color;
  name: string;
  tokens: Token[];
  /** True once all 4 tokens are at FINISH. */
  finished: boolean;

  // --- Phase 2 fields, unused by the Phase 1 local game ---
  uid?: string;
  connected?: boolean;
}

export type MoveKind = 'leaveHome' | 'advance' | 'finish';

/**
 * A fully-resolved legal move. Produced by `getLegalMoves`, applied by
 * `applyMove`. Holding the resolved capture list here means the UI can preview
 * consequences without re-running the rules.
 */
export interface Move {
  tokenId: string;
  from: Progress;
  to: Progress;
  kind: MoveKind;
  /** Ids of opponent tokens sent back to their yard by this move. */
  captures: string[];
}

export type TurnPhase =
  /** The current player must roll. */
  | 'awaiting-roll'
  /** Dice are rolled and at least one legal move is pending. */
  | 'awaiting-move'
  /** The game is over; nothing more can be done. */
  | 'game-over';

export type GameEvent =
  | { type: 'rolled'; color: Color; value: number }
  | { type: 'moved'; color: Color; move: Move }
  | { type: 'captured'; by: Color; tokenIds: string[] }
  | { type: 'threeSixes'; color: Color }
  | { type: 'noLegalMove'; color: Color; value: number }
  /** The turn passed because this player was away. */
  | { type: 'skipped'; color: Color }
  | { type: 'finishedToken'; color: Color; tokenId: string }
  | { type: 'playerWon'; color: Color; place: number };

export interface GameState {
  /** 2..4 players, seated in clockwise track order. */
  players: Player[];
  /** Index into `players` — whose turn it is. */
  turnIndex: number;
  phase: TurnPhase;
  /** The current roll, or null while awaiting a roll. */
  dice: number | null;
  /**
   * The face last rolled, kept for display. Unlike `dice` this survives a roll
   * that could not be used, so the die never blanks out mid-game.
   */
  lastRoll: number | null;
  /** Consecutive sixes rolled in this turn (0..3). Resets on a non-six. */
  consecutiveSixes: number;
  /** Finish order by color. */
  winnerOrder: Color[];
  /** Serializable RNG state, so the whole GameState stays JSON and replayable. */
  rngSeed: number;
  /** Most recent thing that happened, for UI messaging and animations. */
  lastEvent: GameEvent | null;
  /** Bumped on every state transition. Phase 2 uses it to reject stale writes. */
  version: number;
}
