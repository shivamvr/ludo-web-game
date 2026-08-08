import { useMemo } from 'react';
import {
  CENTER_ORIGIN,
  CENTER_SIZE,
  GRID_SIZE,
  HOME_COLUMN,
  HOME_ENTRY_INDEX,
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

type CellKind = 'empty' | 'yard' | 'track' | 'home' | 'center';

type Arrow = 'up' | 'down' | 'left' | 'right';

interface CellInfo {
  kind: CellKind;
  color?: Color;
  isStart?: boolean;
  isStar?: boolean;
  /** Drawn on each arm tip, pointing into that colour's home column. */
  arrow?: Arrow;
  arrowColor?: Color;
}

/** Which way the arrow on a colour's arm tip points, toward the centre. */
const ARROW_DIRECTION: Record<Color, Arrow> = {
  green: 'right',
  yellow: 'down',
  blue: 'left',
  red: 'up',
};

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
  const entryColor = new Map<number, Color>(
    COLORS.map((color) => [HOME_ENTRY_INDEX[color], color] as const),
  );
  TRACK.forEach((cell, index) => {
    const arrowFor = entryColor.get(index);
    grid[at(cell.row, cell.col)] = {
      kind: 'track',
      color: startColor.get(index),
      isStart: startColor.has(index),
      // Every safe square gets a star, entry squares included — a token standing
      // on one cannot be captured, so the marking has to say so consistently.
      isStar: isSafeIndex(index),
      arrow: arrowFor && ARROW_DIRECTION[arrowFor],
      arrowColor: arrowFor,
    };
  });

  for (const color of COLORS) {
    for (const cell of HOME_COLUMN[color]) {
      grid[at(cell.row, cell.col)] = { kind: 'home', color };
    }
  }

  // The whole 3x3 block is the goal; the triangles are drawn as one overlay on
  // top, so these cells only need to stay blank.
  for (let r = CENTER_ORIGIN.row; r < CENTER_ORIGIN.row + CENTER_SIZE; r++) {
    for (let c = CENTER_ORIGIN.col; c < CENTER_ORIGIN.col + CENTER_SIZE; c++) {
      grid[at(r, c)] = { kind: 'center' };
    }
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
          if (info.arrow) classes.push(`cell--arrow cell--arrow-${info.arrow}`);
          if (info.arrowColor) classes.push(`cell--arrow-${info.arrowColor}`);
          if (targets.has(`${row},${col}`)) classes.push('cell--target');
          return <div key={i} className={classes.join(' ')} />;
        })}
      </div>

      {/* The centre goal: four triangles meeting in the middle of the 3x3 block. */}
      <div
        className="goal"
        style={{
          left: `${CENTER_ORIGIN.col * UNIT}%`,
          top: `${CENTER_ORIGIN.row * UNIT}%`,
          width: `${CENTER_SIZE * UNIT}%`,
          height: `${CENTER_SIZE * UNIT}%`,
        }}
        aria-hidden="true"
      >
        {(['up', 'right', 'down', 'left'] as const).map((side, i) => (
          <span key={side} className={`goal__wedge goal__wedge--${['yellow', 'blue', 'red', 'green'][i]} goal__wedge--${side}`} />
        ))}
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
