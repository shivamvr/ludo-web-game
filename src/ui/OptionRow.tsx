import './OptionRow.css';

export interface Choice<T> {
  value: T;
  label: string;
}

interface Props<T> {
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}

/**
 * A labelled row of mutually exclusive choices, used for every rule the host
 * picks before starting. Shared so the online lobby and the pass-and-play setup
 * offer exactly the same options laid out exactly the same way.
 */
export default function OptionRow<T extends string | number>({
  label,
  choices,
  value,
  onChange,
  disabled,
}: Props<T>) {
  return (
    <div className="option-row">
      <span className="field__label">{label}</span>
      <div
        className="option-row__choices"
        role="group"
        aria-label={label}
        // Even columns however many there are, so a two-way choice fills the
        // row rather than leaving a gap where three more used to be.
        style={{ gridTemplateColumns: `repeat(${choices.length}, 1fr)` }}
      >
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            className={`option-row__choice${choice.value === value ? ' option-row__choice--on' : ''}`}
            onClick={() => onChange(choice.value)}
            disabled={disabled}
            aria-pressed={choice.value === value}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
