import { useState } from 'react';
import type { Color } from '../game/types';
import { COLORS } from '../game/types';

interface Props {
  onStart: (colors: Color[]) => void;
  onBack: () => void;
}

/**
 * Phase 1 seat picker. Phase 2 replaces this with the lobby, but the output is
 * the same: the list of colors to hand to createGame.
 */
export default function Setup({ onStart, onBack }: Props) {
  const [selected, setSelected] = useState<Color[]>(['red', 'green', 'yellow', 'blue']);

  const toggle = (color: Color) => {
    setSelected((prev) =>
      prev.includes(color) ? prev.filter((c) => c !== color) : [...prev, color],
    );
  };

  const ready = selected.length >= 2;

  return (
    <div className="setup">
      <h1 className="setup__title">Ludo</h1>
      <p className="setup__subtitle">Pass-and-play on one device. Pick 2 to 4 colors.</p>

      <div className="setup__colors">
        {COLORS.map((color) => {
          const on = selected.includes(color);
          return (
            <button
              key={color}
              type="button"
              className={`seat seat--${color}${on ? ' seat--on' : ''}`}
              onClick={() => toggle(color)}
              aria-pressed={on}
            >
              <span className="seat__swatch" />
              {color}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="setup__start"
        onClick={() => onStart(selected)}
        disabled={!ready}
      >
        {ready ? `Start ${selected.length}-player game` : 'Pick at least 2 colors'}
      </button>

      <button type="button" className="link-button" onClick={onBack}>
        Back
      </button>
    </div>
  );
}
