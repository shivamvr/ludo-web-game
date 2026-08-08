import { useMemo } from 'react';
import {
  CENTER,
  GRID_SIZE,
  HOME_COLUMN,
  STAR_INDICES,
  START_INDEX,
  TRACK,
  YARD_ORIGIN,
  YARD_SLOT_CENTERS,
  cellCenter,
  isSafeIndex,
  progressToCell,
} from '../game/board';
import type { Cell, Point } from '../game/board';
import type { Color, GameState, Move } from '../game/types';
import { COLORS } from '../game/types';
import TokenPiece from './TokenPiece';
import './Board.css';

type CellKind = 'empty' | 'yard' | 'track' | 'home' | 'center' | 'goalCorner';

interface CellInfo {
  kind: CellKind;
  color?: Color;
  isStart?: boolean;
  isStar?: boolean;
}

const cellKey = (c: Cell | Point) => `${c.row},${c.col}`;

/** One grid cell as a percentage of the board's width. */
const UNIT = 100 / GRID_SIZE;

/** Classify all 225 grid squares once — this never changes. */
const GRID: CellInfo[] = (() => {
  const grid: CellInfo[] = Array.from({ length: GRID_SIZE * GRID_SIZE }, () => ({
    kind: 'empty' as CellKind,
  }));
  const at = (row: number, col: number) => row * GRID_SIZE + col;

  for (const color of COLORS) {
    const o = YARD_ORIGIN[color];
    for (let r = o.row; r < o.row + 6; r++) {
      for (let c = o.col; c < o.col + 6; c++) {
        grid[at(r, c)] = { kind: 'yard', color };
      }
    }
  }

  const startColor = new Map<number, Color>(
    COLORS.map((color) => [START_INDEX[color], color] as const),
  );
  TRACK.forEach((cell, index) => {
    grid[at(cell.row, cell.col)] = {
      kind: 'track',
      color: startColor.get(index),
      isStart: startColor.has(index),
      isStar: STAR_INDICES.includes(index) && isSafeIndex(index),
    };
  });

  for (const color of COLORS) {
    for (const cell of HOME_COLUMN[color]) {
      grid[at(cell.row, cell.col)] = { kind: 'home', color };
    }
  }

  grid[at(CENTER.row, CENTER.col)] = { kind: 'center' };
  for (const [r, c] of [
    [6, 6],
    [6, 8],
    [8, 6],
    [8, 8],
  ]) {
    grid[at(r, c)] = { kind: 'goalCorner' };
  }

  return grid;
})();

interface Props {
  state: GameState;
  legalMoves: Move[];
  onTokenClick: (tokenId: string) => void;
}

export default function Board({ state, legalMoves, onTokenClick }: Props) {
  const movable = useMemo(
    () => new Map(legalMoves.map((m) => [m.tokenId, m] as const)),
    [legalMoves],
  );

  /** Destination squares of the current legal moves, for the target rings. */
  const targets = useMemo(() => {
    const set = new Set<string>();
    for (const move of legalMoves) {
      const color = state.players[state.turnIndex].color;
      const cell = progressToCell(color, move.to);
      if (cell) set.add(cellKey(cell));
    }
    return set;
  }, [legalMoves, state.players, state.turnIndex]);

  /** Tokens sent home by the move that just happened, so they can flash. */
  const justCaptured = useMemo(() => {
    const event = state.lastEvent;
    return new Set(event?.type === 'captured' ? event.tokenIds : []);
  }, [state.lastEvent]);

  /** Every token laid out on the grid, fanned out where squares are shared. */
  const placed = useMemo(() => {
    const occupancy = new Map<string, number>();
    const items = state.players.flatMap((player) =>
      player.tokens.map((token, index) => {
        // Yard slots are already centres, drawn in from their corner cell;
        // everywhere else a token sits in the middle of its cell.
        const point =
          token.progress === 0
            ? YARD_SLOT_CENTERS[player.color][index]
            : cellCenter(progressToCell(player.color, token.progress)!);
        const key = cellKey(point);
        const slot = occupancy.get(key) ?? 0;
        occupancy.set(key, slot + 1);
        return { token, point, key, slot };
      }),
    );

    const unit = UNIT;
    return items.map(({ token, point, key, slot }) => {
      const shared = occupancy.get(key)!;
      // Fan overlapping tokens out along a short diagonal so each stays tappable.
      // The fan tightens as the pile grows, so even all 16 tokens stacked on the
      // center stay within about one square.
      const spread = shared > 1 ? unit * Math.min(0.3, 1 / shared) : 0;
      const offset = shared > 1 ? slot - (shared - 1) / 2 : 0;
      return {
        id: token.id,
        color: token.color,
        left: point.col * unit + offset * spread,
        top: point.row * unit + offset * spread,
        scale: shared > 4 ? 0.6 : shared > 2 ? 0.78 : 1,
      };
    });
  }, [state.players]);

  return (
    <div className="board" role="group" aria-label="Ludo board">
      <div className="board__grid">
        {GRID.map((info, i) => {
          const row = Math.floor(i / GRID_SIZE);
          const col = i % GRID_SIZE;
          const classes = ['cell', `cell--${info.kind}`];
          if (info.color) classes.push(`cell--${info.color}`);
          if (info.isStart) classes.push('cell--start');
          if (info.isStar) classes.push('cell--star');
          if (targets.has(`${row},${col}`)) classes.push('cell--target');
          return <div key={i} className={classes.join(' ')} />;
        })}
      </div>

      {/*
        Yard pads and parking rings live in their own grid layer. Putting them
        in the cell grid would displace the auto-placed squares.
      */}
      <div className="board__overlay" aria-hidden="true">
        {COLORS.map((color) => {
          const o = YARD_ORIGIN[color];
          return (
            <div
              key={`pad-${color}`}
              className="yard-pad"
              style={{ gridArea: `${o.row + 2} / ${o.col + 2} / span 4 / span 4` }}
            />
          );
        })}
        {COLORS.flatMap((color) =>
          YARD_SLOT_CENTERS[color].map((point, i) => (
            <div
              key={`slot-${color}-${i}`}
              className={`yard-slot yard-slot--${color}`}
              style={{ left: `${point.col * UNIT}%`, top: `${point.row * UNIT}%` }}
            />
          )),
        )}
      </div>

      <div className="board__tokens">
        {placed.map((p) => (
          <TokenPiece
            key={p.id}
            color={p.color}
            left={p.left}
            top={p.top}
            scale={p.scale}
            movable={movable.has(p.id)}
            captured={justCaptured.has(p.id)}
            captureKey={state.version}
            onClick={() => onTokenClick(p.id)}
          />
        ))}
      </div>
    </div>
  );
}
