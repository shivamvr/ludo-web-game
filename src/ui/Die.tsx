/** Pip layout for each face, on a 3x3 grid numbered 1..9. */
const PIPS: Record<number, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

interface Props {
  value: number | null;
  /** Changes whenever the game state advances, so the tumble replays per roll. */
  roll?: number;
}

export default function Die({ value, roll }: Props) {
  return (
    // Keying on the roll counter remounts the element, which is what restarts
    // the tumble animation for a repeated value such as two sixes in a row.
    <div
      key={roll}
      className={`die${value === null ? '' : ' die--rolled'}`}
      aria-label={value ? `Rolled ${value}` : 'No roll yet'}
      aria-live="polite"
    >
      {value === null
        ? <span className="die__idle">?</span>
        : Array.from({ length: 9 }, (_, i) => (
            <span key={i} className={PIPS[value].includes(i + 1) ? 'die__pip' : ''} />
          ))}
    </div>
  );
}
