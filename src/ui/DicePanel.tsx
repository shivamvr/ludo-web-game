import type { GameState, Player } from '../game/types';
import Die from './Die';
import './DicePanel.css';

interface Props {
  state: GameState;
  player: Player;
  canRoll: boolean;
  awaitingMove: boolean;
  /** Which held number the player is about to spend, if any. */
  selectedDie: number | null;
  /** Numbers that still have a legal move behind them. */
  playableDice: number[];
  onSelectDie: (die: number) => void;
  /** Overrides the button text, e.g. "Waiting…" for a player who is not to move. */
  rollLabel?: string;
  onRoll: () => void;
}

/**
 * Split what was rolled this turn into what is still in hand and what has been
 * spent. Faces are matched off against the held list one at a time, so two sixes
 * with one already played show as one live die and one spent.
 */
function faces(state: GameState): { value: number; spent: boolean }[] {
  const held = [...state.dice];
  return state.lastRoll.map((value) => {
    const at = held.indexOf(value);
    if (at === -1) return { value, spent: true };
    held.splice(at, 1);
    return { value, spent: false };
  });
}

/** Events that mean a die was actually thrown, and so should be seen landing. */
const THROWN = new Set(['rolled', 'noLegalMove', 'threeSixes']);

export default function DicePanel({
  state,
  player,
  canRoll,
  awaitingMove,
  selectedDie,
  playableDice,
  onSelectDie,
  rollLabel,
  onRoll,
}: Props) {
  const rolled = faces(state);
  // More than one number to spend is the only time the choice matters.
  const choosing = awaitingMove && playableDice.length > 1;
  // Only the die just thrown tumbles. The ones already held keep their faces,
  // or a six would appear to be re-rolled every time it is rolled on top of.
  const newest = state.lastEvent && THROWN.has(state.lastEvent.type) ? rolled.length - 1 : -1;

  // The dice are the control: tapping them throws. The two states are mutually
  // exclusive by construction — a roll is only offered while awaiting one, and
  // a number is only picked while awaiting a move — so the tray is never both a
  // button and a row of buttons, which could not be nested anyway.
  const rollable = canRoll && !choosing;

  /** What to do next, said once rather than printed on a button. */
  const hint =
    rollLabel ??
    (awaitingMove
      ? choosing
        ? 'Pick a number'
        : 'Tap a token'
      : canRoll
        ? state.bonusRolls > 0
          ? 'Extra roll — tap the dice'
          : 'Tap the dice to roll'
        : '');

  const dice = (
    <>
      {rolled.length === 0 ? (
        <Die value={null} roll={state.version} />
      ) : (
        rolled.map((face, i) => {
          const selectable = !face.spent && choosing && playableDice.includes(face.value);
          const selected = !face.spent && face.value === selectedDie;
          const className = [
            'dice-tray__slot',
            face.spent ? 'dice-tray__slot--spent' : '',
            selected ? 'dice-tray__slot--selected' : '',
            selectable ? 'dice-tray__slot--selectable' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return selectable ? (
            <button
              key={i}
              type="button"
              className={className}
              onClick={() => onSelectDie(face.value)}
              aria-pressed={selected}
              aria-label={`Play the ${face.value}`}
            >
              <Die value={face.value} roll={state.version} tumble={i === newest} />
            </button>
          ) : (
            <span key={i} className={className}>
              <Die value={face.value} roll={state.version} tumble={i === newest} />
            </span>
          );
        })
      )}
    </>
  );

  const trayClass = `dice-tray dice-tray--${Math.max(rolled.length, 1)}${
    rollable ? ' dice-tray--roll' : ''
  }`;

  return (
    <div className="dice-panel">
      <span className="dice-panel__who">
        <span className={`turn-chip turn-chip--${player.color}`}>
          <span className="turn-chip__dot" />
          {player.name}
        </span>
        <span className="dice-panel__hint" aria-live="polite">
          {hint}
        </span>
      </span>

      {/*
        Everything rolled this turn, not just the pending number: a roll with no
        legal move passes the turn and empties the hand, and the dice should
        still show what came up rather than blanking out.
      */}
      {rollable ? (
        <button type="button" className={trayClass} onClick={onRoll} aria-label="Roll the dice">
          {dice}
        </button>
      ) : (
        <div className={trayClass} role="group" aria-label="Dice rolled this turn">
          {dice}
        </div>
      )}
    </div>
  );
}
