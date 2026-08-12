/**
 * Board geometry. Pure data + pure lookups.
 *
 * The board is a 15x15 grid. Rules code works only in `Progress` integers; this
 * module is the single place that turns (color, progress) into a grid cell, so
 * rendering and rules stay decoupled.
 *
 * Layout:
 *   - Four 6x6 yards in the corners: red top-left, green top-right,
 *     yellow bottom-right, blue bottom-left.
 *   - A 52-cell track running clockwise around the cross.
 *   - Four 6-cell home columns pointing inward, then the center goal at (7,7).
 */

import type { Color, YardExit } from "./types";

export interface Cell {
  row: number;
  col: number;
}

/**
 * A position measured in cell units rather than whole cells: (1.5, 1.5) is the
 * centre of cell (1, 1). Used where something needs to sit between grid lines.
 */
export interface Point {
  row: number;
  col: number;
}

/** The centre of a grid cell, as a Point. */
export function cellCenter(cell: Cell): Point {
  return { row: cell.row + 0.5, col: cell.col + 0.5 };
}

export const GRID_SIZE = 15;

/** Cells on the shared main track. */
export const TRACK_LENGTH = 52;
/** How many track cells a token visits, from its start square inclusive. */
export const MAIN_TRACK_STEPS = 51;
/**
 * Coloured cells in each player's own home column. Five, because the centre
 * goal occupies the whole 3x3 block where the four arms meet.
 */
export const HOME_COLUMN_LENGTH = 5;

/** progress values: 0 = yard, 1..51 = track, 52..56 = home column, 57 = center. */
export const YARD: number = 0;
export const HOME_COLUMN_START: number = MAIN_TRACK_STEPS + 1; // 52
export const FINISH: number = MAIN_TRACK_STEPS + HOME_COLUMN_LENGTH + 1; // 57

export const CENTER: Cell = { row: 7, col: 7 };

/** The 3x3 block of cells the centre goal is drawn across. */
export const CENTER_ORIGIN: Cell = { row: 6, col: 6 };
export const CENTER_SIZE = 3;

/**
 * The 52 track cells in clockwise order, starting at red's start square (6,1).
 * The four "diagonal" steps ((6,5)->(5,6) and friends) are the corners where two
 * arms of the cross meet — the cell between them belongs to the center block and
 * carries no path.
 */
export const TRACK: readonly Cell[] = [
  // left arm, upper row — red's start square first
  { row: 6, col: 1 },
  { row: 6, col: 2 },
  { row: 6, col: 3 },
  { row: 6, col: 4 },
  { row: 6, col: 5 },
  // top arm, left column, going up
  { row: 5, col: 6 },
  { row: 4, col: 6 },
  { row: 3, col: 6 },
  { row: 2, col: 6 },
  { row: 1, col: 6 },
  { row: 0, col: 6 },
  // top arm tip
  { row: 0, col: 7 },
  // top arm, right column, coming down — green's start square at (1,8)
  { row: 0, col: 8 },
  { row: 1, col: 8 },
  { row: 2, col: 8 },
  { row: 3, col: 8 },
  { row: 4, col: 8 },
  { row: 5, col: 8 },
  // right arm, upper row
  { row: 6, col: 9 },
  { row: 6, col: 10 },
  { row: 6, col: 11 },
  { row: 6, col: 12 },
  { row: 6, col: 13 },
  { row: 6, col: 14 },
  // right arm tip
  { row: 7, col: 14 },
  // right arm, lower row, coming back — yellow's start square at (8,13)
  { row: 8, col: 14 },
  { row: 8, col: 13 },
  { row: 8, col: 12 },
  { row: 8, col: 11 },
  { row: 8, col: 10 },
  { row: 8, col: 9 },
  // bottom arm, right column, going down
  { row: 9, col: 8 },
  { row: 10, col: 8 },
  { row: 11, col: 8 },
  { row: 12, col: 8 },
  { row: 13, col: 8 },
  { row: 14, col: 8 },
  // bottom arm tip
  { row: 14, col: 7 },
  // bottom arm, left column, coming up — blue's start square at (13,6)
  { row: 14, col: 6 },
  { row: 13, col: 6 },
  { row: 12, col: 6 },
  { row: 11, col: 6 },
  { row: 10, col: 6 },
  { row: 9, col: 6 },
  // left arm, lower row, coming back
  { row: 8, col: 5 },
  { row: 8, col: 4 },
  { row: 8, col: 3 },
  { row: 8, col: 2 },
  { row: 8, col: 1 },
  { row: 8, col: 0 },
  // left arm tip
  { row: 7, col: 0 },
  // back to red's start
  { row: 6, col: 0 },
];

/**
 * Where each colour joins the track — also its safe start square. The values
 * place each colour's yard in its corner: green top-left, yellow top-right,
 * blue bottom-right, red bottom-left.
 */
export const START_INDEX: Record<Color, number> = {
  green: 0,
  yellow: 13,
  blue: 26,
  red: 39,
};

/**
 * The last track cell a colour stands on — the tip of its arm, where it turns
 * into its home column. Drawn with an arrow pointing inward.
 */
export const HOME_ENTRY_INDEX: Record<Color, number> = {
  green: (START_INDEX.green + MAIN_TRACK_STEPS - 1) % TRACK_LENGTH,
  yellow: (START_INDEX.yellow + MAIN_TRACK_STEPS - 1) % TRACK_LENGTH,
  blue: (START_INDEX.blue + MAIN_TRACK_STEPS - 1) % TRACK_LENGTH,
  red: (START_INDEX.red + MAIN_TRACK_STEPS - 1) % TRACK_LENGTH,
};

/**
 * The star safe square each colour owns, 8 steps past its start square. That
 * puts it on the stretch of track running alongside that colour's own yard,
 * which is why the board paints it in the same colour.
 */
export const STAR_INDEX: Record<Color, number> = {
  green: (START_INDEX.green + 8) % TRACK_LENGTH,
  yellow: (START_INDEX.yellow + 8) % TRACK_LENGTH,
  blue: (START_INDEX.blue + 8) % TRACK_LENGTH,
  red: (START_INDEX.red + 8) % TRACK_LENGTH,
};

/** Star safe squares: 8 steps past each start square. */
export const STAR_INDICES: readonly number[] = Object.values(STAR_INDEX);

/** All safe absolute track indices: the four starts plus the four stars. */
export const SAFE_INDICES: readonly number[] = [
  ...Object.values(START_INDEX),
  ...STAR_INDICES,
].sort((a, b) => a - b);

const SAFE_SET = new Set(SAFE_INDICES);

/** The 5 coloured home-column cells for each colour, ordered from outside in. */
export const HOME_COLUMN: Record<Color, readonly Cell[]> = {
  green: [1, 2, 3, 4, 5].map((col) => ({ row: 7, col })),
  yellow: [1, 2, 3, 4, 5].map((row) => ({ row, col: 7 })),
  blue: [13, 12, 11, 10, 9].map((col) => ({ row: 7, col })),
  red: [13, 12, 11, 10, 9].map((row) => ({ row, col: 7 })),
};

/** Top-left corner of each 6x6 yard. */
export const YARD_ORIGIN: Record<Color, Cell> = {
  green: { row: 0, col: 0 },
  yellow: { row: 0, col: 9 },
  blue: { row: 9, col: 9 },
  red: { row: 9, col: 0 },
};

/** The colour whose yard sits in the opposite corner of the board. */
export const OPPOSITE_CORNER: Record<Color, Color> = {
  green: "blue", // top-left    <-> bottom-right
  blue: "green",
  yellow: "red", // top-right   <-> bottom-left
  red: "yellow",
};

/**
 * The order colours are handed out in as players arrive. Not the turn order,
 * which stays COLORS — this only decides who gets which corner.
 *
 * The first two are opposite corners, so a two-player game is played across the
 * board rather than along one edge. Seated side by side, one player's home
 * column runs alongside the other's start, and most of the board never comes
 * into play.
 */
export const SEATING_ORDER: readonly Color[] = [
  "red",
  "yellow",
  "green",
  "blue",
];

/** How many tokens each player may be given. */
export const TOKEN_COUNTS: readonly number[] = [4, 5, 6, 7, 8];
export const DEFAULT_TOKEN_COUNT = 4;
export const MIN_TOKEN_COUNT = TOKEN_COUNTS[0];
export const MAX_TOKEN_COUNT = TOKEN_COUNTS[TOKEN_COUNTS.length - 1];

export function isTokenCount(value: unknown): boolean {
  return typeof value === "number" && TOKEN_COUNTS.includes(value);
}

/** Which numbers a table may agree open the yard — see YardExit. */
export const YARD_EXITS: readonly YardExit[] = ["six", "one-or-six"];
export const DEFAULT_YARD_EXIT: YardExit = "six";

export function isYardExit(value: unknown): value is YardExit {
  return typeof value === "string" && YARD_EXITS.includes(value as YardExit);
}

/** Whether this number can bring a token out of the yard under `exit`. */
export function opensYard(exit: YardExit, die: number): boolean {
  return die === 6 || (exit === "one-or-six" && die === 1);
}

/**
 * How far the outermost parking slots sit in from the centre of their corner
 * cell, in cell units. Without it the tokens sit hard against the yard's inner
 * border. Two slots to an axis can afford to sit wide; three have to draw in to
 * leave room between them.
 */
const YARD_SLOT_INSET: Record<number, number> = { 2: 0.5, 3: 0.2 };

/** The centres of `n` slots spread evenly about the middle of a yard axis. */
function axis(n: number, of: number): number[] {
  // Both a full row and a short one step by the same amount, so a partial row
  // sits centred under the row above rather than drifting out of line.
  const step = n === 1 ? 0 : (3 - 2 * YARD_SLOT_INSET[of]) / (of - 1);
  return Array.from({ length: n }, (_, i) => 3 + (i - (n - 1) / 2) * step);
}

/**
 * The parking slots inside a yard, in token order.
 *
 * Laid out as a grid: two to a row up to four tokens, three thereafter, with any
 * short final row centred. Four keeps the square arrangement it has always had.
 */
function slots(origin: Cell, count: number): readonly Point[] {
  const cols = count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / cols);
  const ys = axis(rows, rows);

  const points: Point[] = [];
  for (let row = 0; row < rows; row++) {
    const inRow = Math.min(cols, count - row * cols);
    for (const x of axis(inRow, cols)) {
      points.push({ row: origin.row + ys[row], col: origin.col + x });
    }
  }
  return points;
}

/** Centres of a colour's parking slots, for a game of `count` tokens each. */
export function yardSlots(color: Color, count: number): readonly Point[] {
  return slots(YARD_ORIGIN[color], count);
}

/** The default four-token arrangement, kept for callers that have no game yet. */
export const YARD_SLOT_CENTERS: Record<Color, readonly Point[]> = {
  red: yardSlots("red", DEFAULT_TOKEN_COUNT),
  green: yardSlots("green", DEFAULT_TOKEN_COUNT),
  yellow: yardSlots("yellow", DEFAULT_TOKEN_COUNT),
  blue: yardSlots("blue", DEFAULT_TOKEN_COUNT),
};

/**
 * The absolute track index a token stands on, or null when it is not on the
 * shared track (in the yard, in a home column, or finished). Two tokens collide
 * only if this returns the same non-null value for both.
 */
export function absoluteTrackIndex(
  color: Color,
  progress: number,
): number | null {
  if (progress < 1 || progress > MAIN_TRACK_STEPS) return null;
  return (START_INDEX[color] + progress - 1) % TRACK_LENGTH;
}

/** True if the absolute track index is a start or star square. */
export function isSafeIndex(index: number): boolean {
  return SAFE_SET.has(index);
}

/** True if a token at this progress is standing on a safe square. */
export function isSafeProgress(color: Color, progress: number): boolean {
  const index = absoluteTrackIndex(color, progress);
  return index !== null && isSafeIndex(index);
}

/**
 * The grid cell a token occupies, or null if it is in the yard (the caller uses
 * YARD_SLOTS for those, since slot choice depends on token index).
 */
export function progressToCell(color: Color, progress: number): Cell | null {
  if (progress === YARD) return null;
  if (progress <= MAIN_TRACK_STEPS) {
    return TRACK[absoluteTrackIndex(color, progress)!];
  }
  if (progress < FINISH) {
    return HOME_COLUMN[color][progress - HOME_COLUMN_START];
  }
  return CENTER;
}
