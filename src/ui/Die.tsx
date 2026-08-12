import { useEffect, useRef, useState, type CSSProperties } from 'react';
import face1 from '../assets/dice-1.svg';
import face2 from '../assets/dice-2.svg';
import face3 from '../assets/dice-3.svg';
import face4 from '../assets/dice-4.svg';
import face5 from '../assets/dice-5.svg';
import face6 from '../assets/dice-6.svg';
import { reducedMotion } from './motion';
import { ROLL_TIMING } from './useSound';

/**
 * The drawn faces, from the asset pack. Small enough that the bundler inlines
 * them, so a face that comes up mid-tumble is already there — nothing is
 * fetched while the die is in the air.
 */
const FACES: Record<number, string> = {
  1: face1,
  2: face2,
  3: face3,
  4: face4,
  5: face5,
  6: face6,
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
      className={`die${value === null ? ' die--blank' : ' die--rolled'}${
        tumble ? ' die--tumbling' : ''
      }`}
      style={
        {
          '--tumble': `${ROLL_TIMING.settle + ROLL_TIMING.bounce}ms`,
          // Quoted, and it has to be: the face is inlined as a data URI, and
          // the artwork refers to its own gradients as url(#body). Unquoted,
          // that inner bracket closes this one and the whole declaration is
          // thrown away — leaving a die with no face at all.
          ...(showing === null ? {} : { backgroundImage: `url("${FACES[showing]}")` }),
        } as CSSProperties
      }
      aria-label={value ? `Rolled ${value}` : 'No roll yet'}
      aria-live="polite"
    >
      {showing === null && <span className="die__idle">?</span>}
    </div>
  );
}
