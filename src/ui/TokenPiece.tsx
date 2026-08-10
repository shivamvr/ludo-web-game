import type { CSSProperties } from 'react';
import type { Color } from '../game/types';

interface Props {
  color: Color;
  /** Percentage of the board's width/height, 0..100. */
  left: number;
  top: number;
  /** Shrink when several tokens share one square. */
  scale: number;
  /** Set while the token is walking, and equal to one square's worth of time. */
  hopMs?: number;
  /** Set while the token is being thrown back to its yard after being taken. */
  flightMs?: number;
  movable: boolean;
  /** Rendered above the rest when it is a legal target. */
  onClick?: () => void;
}

/**
 * One token. Positioned as a percentage of the board so it scales with the
 * board and can be transitioned smoothly. The tap target is enlarged with a
 * transparent ::after so small board cells stay thumb-friendly on phones.
 */
export default function TokenPiece({
  color,
  left,
  top,
  scale,
  hopMs,
  flightMs,
  movable,
  onClick,
}: Props) {
  const Element = movable ? 'button' : 'div';
  return (
    <Element
      className={`token token--${color}${movable ? ' token--movable' : ''}${
        hopMs ? ' token--hopping' : ''
      }${flightMs ? ' token--returning' : ''}`}
      style={
        {
          left: `${left}%`,
          top: `${top}%`,
          '--scale': scale,
          // Each drives both a slide and the arc over it, so a token lands
          // exactly where and when the movement says it should.
          ...(hopMs ? { '--hop': `${hopMs}ms` } : {}),
          ...(flightMs ? { '--flight': `${flightMs}ms` } : {}),
        } as CSSProperties
      }
      onClick={movable ? onClick : undefined}
      {...(movable ? { type: 'button' as const, 'aria-label': `Move ${color} token` } : {})}
    >
      {/*
        The white flash of being hit, as a child rather than on the token
        itself. Restarting an animation means remounting the element it is on,
        and remounting the token would cancel the transition carrying it home —
        it would arrive in its yard instantly instead of being seen to travel.
      */}
      {flightMs && <span className="token__hit" aria-hidden="true" />}
    </Element>
  );
}
