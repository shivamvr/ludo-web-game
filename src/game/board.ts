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

import type { Color } from "./types";

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

/** Star safe squares: 8 steps past each start square. */
export const STAR_INDICES: readonly number[] = [8, 21, 34, 47];

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

/**
 * How far each parking slot is drawn in from the centre of its corner cell, in
 * cell units. Without it the tokens sit hard against the yard's inner border.
 */
const YARD_SLOT_INSET = 0.5;

function slots(origin: Cell): readonly Point[] {
  const near = 1.5 + YARD_SLOT_INSET;
  const far = 4.5 - YARD_SLOT_INSET;
  return [
    { row: origin.row + near, col: origin.col + near },
    { row: origin.row + near, col: origin.col + far },
    { row: origin.row + far, col: origin.col + near },
    { row: origin.row + far, col: origin.col + far },
  ];
}

/** Centres of the four parking slots inside a yard, in token order. */
export const YARD_SLOT_CENTERS: Record<Color, readonly Point[]> = {
  red: slots(YARD_ORIGIN.red),
  green: slots(YARD_ORIGIN.green),
  yellow: slots(YARD_ORIGIN.yellow),
  blue: slots(YARD_ORIGIN.blue),
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
