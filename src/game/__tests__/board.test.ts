import { describe, expect, it } from 'vitest';
import {
  CENTER,
  FINISH,
  GRID_SIZE,
  HOME_COLUMN,
  HOME_COLUMN_LENGTH,
  MAIN_TRACK_STEPS,
  SAFE_INDICES,
  START_INDEX,
  TRACK,
  TRACK_LENGTH,
  YARD_ORIGIN,
  YARD_SLOT_CENTERS,
  absoluteTrackIndex,
  isSafeIndex,
  progressToCell,
} from '../board';
import { COLORS } from '../types';
import type { Cell } from '../board';

const key = (c: Cell) => `${c.row},${c.col}`;

describe('track geometry', () => {
  it('has 52 distinct cells inside the grid', () => {
    expect(TRACK).toHaveLength(TRACK_LENGTH);
    expect(new Set(TRACK.map(key)).size).toBe(TRACK_LENGTH);
    for (const cell of TRACK) {
      expect(cell.row).toBeGreaterThanOrEqual(0);
      expect(cell.row).toBeLessThan(GRID_SIZE);
      expect(cell.col).toBeGreaterThanOrEqual(0);
      expect(cell.col).toBeLessThan(GRID_SIZE);
    }
  });

  it('is a closed loop of adjacent cells, turning at exactly four corners', () => {
    let diagonals = 0;
    for (let i = 0; i < TRACK_LENGTH; i++) {
      const a = TRACK[i];
      const b = TRACK[(i + 1) % TRACK_LENGTH];
      const dr = Math.abs(a.row - b.row);
      const dc = Math.abs(a.col - b.col);
      expect(dr).toBeLessThanOrEqual(1);
      expect(dc).toBeLessThanOrEqual(1);
      expect(dr + dc).toBeGreaterThan(0);
      if (dr === 1 && dc === 1) diagonals++;
    }
    expect(diagonals).toBe(4);
  });

  it('puts each color on its canonical start square', () => {
    expect(TRACK[START_INDEX.red]).toEqual({ row: 6, col: 1 });
    expect(TRACK[START_INDEX.green]).toEqual({ row: 1, col: 8 });
    expect(TRACK[START_INDEX.yellow]).toEqual({ row: 8, col: 13 });
    expect(TRACK[START_INDEX.blue]).toEqual({ row: 13, col: 6 });
  });

  it('spaces the four starts evenly around the loop', () => {
    const starts = COLORS.map((c) => START_INDEX[c]);
    for (let i = 0; i < starts.length; i++) {
      const gap = (starts[(i + 1) % starts.length] - starts[i] + TRACK_LENGTH) % TRACK_LENGTH;
      expect(gap).toBe(TRACK_LENGTH / 4);
    }
  });
});

describe('per-color paths', () => {
  it('starts every color on its own start square at progress 1', () => {
    for (const color of COLORS) {
      expect(absoluteTrackIndex(color, 1)).toBe(START_INDEX[color]);
    }
  });

  it('turns off at the arm tip, one cell short of its own start square', () => {
    for (const color of COLORS) {
      const last = absoluteTrackIndex(color, MAIN_TRACK_STEPS)!;
      // A token turns into its home column here, so the single cell between
      // this one and its start square is the one square it never visits.
      expect((last + 2) % TRACK_LENGTH).toBe(START_INDEX[color]);

      const visited = new Set<number>();
      for (let p = 1; p <= MAIN_TRACK_STEPS; p++) {
        visited.add(absoluteTrackIndex(color, p)!);
      }
      expect(visited.size).toBe(MAIN_TRACK_STEPS);
      expect(visited.has((START_INDEX[color] - 1 + TRACK_LENGTH) % TRACK_LENGTH)).toBe(false);
    }
  });

  it('joins the home column from an adjacent track cell', () => {
    for (const color of COLORS) {
      const lastTrack = progressToCell(color, MAIN_TRACK_STEPS)!;
      const firstHome = HOME_COLUMN[color][0];
      const dr = Math.abs(lastTrack.row - firstHome.row);
      const dc = Math.abs(lastTrack.col - firstHome.col);
      expect(dr + dc).toBe(1);
    }
  });

  it('gives every color a 6-cell home column that ends beside the center', () => {
    const seen = new Set<string>();
    for (const color of COLORS) {
      const column = HOME_COLUMN[color];
      expect(column).toHaveLength(HOME_COLUMN_LENGTH);
      for (const cell of column) {
        expect(seen.has(key(cell))).toBe(false);
        seen.add(key(cell));
      }
      const innermost = column[HOME_COLUMN_LENGTH - 1];
      const dr = Math.abs(innermost.row - CENTER.row);
      const dc = Math.abs(innermost.col - CENTER.col);
      expect(dr + dc).toBe(1);
    }
  });

  it('walks a continuous, non-repeating path from start to center', () => {
    for (const color of COLORS) {
      const seen = new Set<string>();
      for (let p = 1; p <= FINISH; p++) {
        const cell = progressToCell(color, p)!;
        expect(cell).toBeDefined();
        if (p < FINISH) {
          expect(seen.has(key(cell))).toBe(false);
          seen.add(key(cell));
        }
        if (p > 1) {
          const prev = progressToCell(color, p - 1)!;
          expect(Math.abs(cell.row - prev.row)).toBeLessThanOrEqual(1);
          expect(Math.abs(cell.col - prev.col)).toBeLessThanOrEqual(1);
        }
      }
      expect(progressToCell(color, FINISH)).toEqual(CENTER);
    }
  });

  it('reports no track cell for tokens in the yard or the home column', () => {
    expect(absoluteTrackIndex('red', 0)).toBeNull();
    expect(absoluteTrackIndex('red', MAIN_TRACK_STEPS + 1)).toBeNull();
    expect(absoluteTrackIndex('red', FINISH)).toBeNull();
    expect(progressToCell('red', 0)).toBeNull();
  });
});

describe('safe squares', () => {
  it('marks the four starts and four stars, and nothing else', () => {
    expect(SAFE_INDICES).toEqual([0, 8, 13, 21, 26, 34, 39, 47]);
    for (const color of COLORS) {
      expect(isSafeIndex(START_INDEX[color])).toBe(true);
    }
    expect(isSafeIndex(1)).toBe(false);
    expect(isSafeIndex(51)).toBe(false);
  });

  it('places a star exactly 8 steps past every start square', () => {
    for (const color of COLORS) {
      expect(isSafeIndex(absoluteTrackIndex(color, 9)!)).toBe(true);
    }
  });
});

describe('yards', () => {
  it('gives every color four distinct parking slots in its own corner', () => {
    const seen = new Set<string>();
    for (const color of COLORS) {
      expect(YARD_SLOT_CENTERS[color]).toHaveLength(4);
      for (const point of YARD_SLOT_CENTERS[color]) {
        expect(seen.has(key(point))).toBe(false);
        seen.add(key(point));
      }
    }
    expect(seen.size).toBe(16);
  });

  it('keeps every slot clear of the yard pad it sits on', () => {
    // The white pad covers cells 1..4 of the 6x6 yard, grown by a tenth on each
    // side, and a token is a little under one cell across. Every slot centre
    // must leave room for the token plus a visible margin.
    const padMargin = (4 * 1.1 - 4) / 2; // how far the pad grows past cell 1..4
    const tokenRadius = 0.86 / 2;

    for (const color of COLORS) {
      const origin = YARD_ORIGIN[color];
      const padStart = origin.row + 1 - padMargin;
      const padEnd = origin.row + 5 + padMargin;

      for (const point of YARD_SLOT_CENTERS[color]) {
        for (const axis of [point.row, point.col] as const) {
          const start = axis === point.row ? padStart : origin.col + 1 - padMargin;
          const end = axis === point.row ? padEnd : origin.col + 5 + padMargin;
          expect(axis - tokenRadius - start).toBeGreaterThan(0.25);
          expect(end - (axis + tokenRadius)).toBeGreaterThan(0.25);
        }
      }
    }
  });

  it('keeps the four tokens in a yard well apart', () => {
    for (const color of COLORS) {
      const [first, , , last] = YARD_SLOT_CENTERS[color];
      // Opposite corners of the 2x2 arrangement.
      expect(last.row - first.row).toBeGreaterThan(1.5);
      expect(last.col - first.col).toBeGreaterThan(1.5);
    }
  });
});
