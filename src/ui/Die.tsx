import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { reducedMotion } from './motion';
import { ROLL_TIMING } from './useSound';

/** Pip layout for each face, on a 3x3 grid numbered 1..9. */
const PIPS: Record<number, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

/** A face to flash up mid-tumble. Never the one showing, so every knock reads
 *  as a change even when the same number comes up twice. */
function decoy(not: number): number {
  const face = 1 + Math.floor(Math.random() * 5);
  return face >= not ? face + 1 : face;
}

interface Props {
  value: number | null;
  /** Changes whenever the game state advances, so the tumble replays per roll. */
  roll?: number;
  /** This is the die that was just thrown, as opposed to one already held. */
  tumble?: boolean;
}

export default function Die({ value, roll = 0, tumble = false }: Props) {
  // What is on the face right now. During a tumble this is a decoy; the real
  // value only appears when the die settles.
  const [showing, setShowing] = useState<number | null>(value);
  const previous = useRef(roll);

  if (previous.current !== roll) {
    previous.current = roll;
    // Adjusted during render rather than in an effect: an effect runs after the
    // paint, so the true face would flash up for a frame before the die starts
    // moving — which gives the answer away.
    setShowing(tumble && value !== null && !reducedMotion() ? decoy(value) : value);
  }

  useEffect(() => {
    if (!tumble || value === null || reducedMotion()) {
      setShowing(value);
      return;
    }
    // One decoy per knock after the first, which the render above already
    // placed, then the real face exactly on the settle.
    const timers: number[] = [];
    let face = value;
    for (let i = 1; i < ROLL_TIMING.tumbles; i++) {
      timers.push(
        window.setTimeout(() => {
          face = decoy(face);
          setShowing(face);
        }, i * ROLL_TIMING.gap),
      );
    }
    timers.push(window.setTimeout(() => setShowing(value), ROLL_TIMING.settle));
    return () => timers.forEach(clearTimeout);
  }, [roll, value, tumble]);

  return (
    // Keying on the roll counter remounts the element, which is what restarts
    // the tumble animation for a repeated value such as two sixes in a row.
    <div
      key={roll}
      className={`die${value === null ? '' : ' die--rolled'}${tumble ? ' die--tumbling' : ''}`}
      style={
        {
          '--tumble': `${ROLL_TIMING.settle + ROLL_TIMING.bounce}ms`,
        } as CSSProperties
      }
      aria-label={value ? `Rolled ${value}` : 'No roll yet'}
      aria-live="polite"
    >
      {showing === null ? (
        <span className="die__idle">?</span>
      ) : (
        Array.from({ length: 9 }, (_, i) => (
          <span key={i} className={PIPS[showing].includes(i + 1) ? 'die__pip' : ''} />
        ))
      )}
    </div>
  );
}
