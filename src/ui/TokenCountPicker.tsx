import { TOKEN_COUNTS } from '../game/board';
import './TokenCountPicker.css';

interface Props {
  value: number;
  onChange: (count: number) => void;
  disabled?: boolean;
}

/**
 * How many tokens each player gets. Shared by the online lobby and the
 * pass-and-play setup so the two offer exactly the same choice.
 */
export default function TokenCountPicker({ value, onChange, disabled }: Props) {
  return (
    <div className="tokens">
      <span className="field__label">Tokens each</span>
      <div className="tokens__options" role="group" aria-label="Tokens per player">
        {TOKEN_COUNTS.map((count) => (
          <button
            key={count}
            type="button"
            className={`tokens__option${count === value ? ' tokens__option--on' : ''}`}
            onClick={() => onChange(count)}
            disabled={disabled}
            aria-pressed={count === value}
          >
            {count}
          </button>
        ))}
      </div>
    </div>
  );
}
