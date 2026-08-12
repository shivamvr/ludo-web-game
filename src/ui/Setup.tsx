import { useState } from 'react';
import { DEFAULT_TOKEN_COUNT, DEFAULT_YARD_EXIT } from '../game/board';
import type { Color, YardExit } from '../game/types';
import { COLORS } from '../game/types';
import RulePicker from './RulePicker';

interface Props {
  onStart: (colors: Color[], tokenCount: number, yardExit: YardExit) => void;
  onBack: () => void;
}

/**
 * Phase 1 seat picker. Phase 2 replaces this with the lobby, but the output is
 * the same: the list of colors to hand to createGame.
 */
export default function Setup({ onStart, onBack }: Props) {
  const [selected, setSelected] = useState<Color[]>(['red', 'green', 'yellow', 'blue']);
  const [tokenCount, setTokenCount] = useState(DEFAULT_TOKEN_COUNT);
  const [yardExit, setYardExit] = useState<YardExit>(DEFAULT_YARD_EXIT);

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

      <RulePicker
        tokenCount={tokenCount}
        onTokenCount={setTokenCount}
        yardExit={yardExit}
        onYardExit={setYardExit}
      />

      <button
        type="button"
        className="setup__start"
        onClick={() => onStart(selected, tokenCount, yardExit)}
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
