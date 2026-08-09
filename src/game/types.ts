/**
 * Shared game types. Imported by the pure engine, the UI, and (from Phase 2) the
 * Firebase data layer. Everything here is plain JSON — no class instances, no
 * Maps/Sets, no undefined-only fields — so a whole GameState can be written to
 * Firebase Realtime Database verbatim.
 */

export type Color = 'red' | 'green' | 'yellow' | 'blue';

/**
 * Seat order around the board, and the turn order. Red starts, and the cycle
 * runs clockwise from its corner: red bottom-left, green top-left, yellow
 * top-right, blue bottom-right. Each colour's start square sits a quarter of
 * the way around the track from the one before it.
 */
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
  /** Which of the held numbers this move spends. */
  die: number;
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
  /** Nothing could be done with any of the numbers held. */
  | { type: 'noLegalMove'; color: Color; values: number[] }
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
  /**
   * Numbers rolled this turn and not yet spent, oldest first.
   *
   * A six is held rather than played, and the player rolls again on top of it,
   * so a turn can end up holding several numbers at once. They may then be
   * played in any order, on any legal token — which is the whole point: the
   * choice of pairing is what creates the chance to line up a capture or an
   * exact finish.
   */
  dice: number[];
  /**
   * Everything rolled this turn, spent or not, kept for display. Unlike `dice`
   * this survives a roll that could not be used, so the panel never blanks out.
   */
  lastRoll: number[];
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
