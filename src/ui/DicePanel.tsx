import type { GameState, Player } from '../game/types';
import Die from './Die';
import './DicePanel.css';

interface Props {
  state: GameState;
  player: Player;
  canRoll: boolean;
  awaitingMove: boolean;
  /** Overrides the button text, e.g. "Waiting…" for a player who is not to move. */
  rollLabel?: string;
  onRoll: () => void;
}

export default function DicePanel({
  state,
  player,
  canRoll,
  awaitingMove,
  rollLabel,
  onRoll,
}: Props) {
  return (
    <div className="dice-panel">
      <span className={`turn-chip turn-chip--${player.color}`}>
        <span className="turn-chip__dot" />
        {player.name}
      </span>
      {/*
        The face last rolled, not the pending roll: a roll with no legal move
        passes the turn and clears `dice`, and the die should still show what
        came up rather than blanking out.
      */}
      <Die value={state.lastRoll} roll={state.version} />
      <button type="button" className="roll-button" onClick={onRoll} disabled={!canRoll}>
        {rollLabel ?? (awaitingMove ? 'Tap a token' : 'Roll')}
      </button>
    </div>
  );
}
