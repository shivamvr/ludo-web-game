import type { CSSProperties } from 'react';
import type { Color } from '../game/types';

interface Props {
  color: Color;
  /** Percentage of the board's width/height, 0..100. */
  left: number;
  top: number;
  /** Shrink when several tokens share one square. */
  scale: number;
  movable: boolean;
  /** This token was just sent home, and flashes on its way back to the yard. */
  captured?: boolean;
  /** Bumps per state change so a repeated capture replays the flash. */
  captureKey?: number;
  /** Rendered above the rest when it is a legal target. */
  onClick?: () => void;
}

/**
 * One token. Positioned as a percentage of the board so it scales with the
 * board and can be transitioned smoothly later. The tap target is enlarged with
 * a transparent ::after so small board cells stay thumb-friendly on phones.
 */
export default function TokenPiece({
  color,
  left,
  top,
  scale,
  movable,
  captured,
  captureKey,
  onClick,
}: Props) {
  const Element = movable ? 'button' : 'div';
  return (
    <Element
      // The key only changes for a token that was just captured, so the flash
      // animation restarts without disturbing every other token's transition.
      key={captured ? `hit-${captureKey}` : undefined}
      className={`token token--${color}${movable ? ' token--movable' : ''}${
        captured ? ' token--captured' : ''
      }`}
      style={{ left: `${left}%`, top: `${top}%`, '--scale': scale } as CSSProperties}
      onClick={movable ? onClick : undefined}
      {...(movable ? { type: 'button' as const, 'aria-label': `Move ${color} token` } : {})}
    >
      <span className="token__dot" />
    </Element>
  );
}
