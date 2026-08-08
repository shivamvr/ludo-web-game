import { useEffect, useRef, type ReactNode } from 'react';
import { currentTurn, standings } from '../game/engine';
import type { GameEvent, GameState, Move } from '../game/types';
import Board from './Board';
import DicePanel from './DicePanel';
import { useSound, type Cue } from './useSound';
import './LocalGame.css';

/** Which sound, if any, a state transition should make. */
function cueFor(event: GameEvent | null): Cue | null {
  switch (event?.type) {
    case 'rolled':
    case 'noLegalMove':
      return 'roll';
    case 'moved':
      return 'move';
    case 'captured':
      return 'capture';
    case 'finishedToken':
      return 'home';
    case 'playerWon':
      return 'win';
    case 'threeSixes':
    case 'skipped':
      return 'skip';
    default:
      return null;
  }
}

interface Props {
  state: GameState;
  legalMoves: Move[];
  canRoll: boolean;
  onRoll: () => void;
  onTokenClick: (tokenId: string) => void;
  /** Overrides the roll button's text — "Waiting…" while it is someone else's turn. */
  rollLabel?: string;
  /** Shown between the header and the board: whose turn it is, connection notices. */
  banner?: ReactNode;
  /** Ends the game for a reason the rules do not know about, e.g. abandonment. */
  ended?: { title: string; subtitle?: string };
  headerAction: { label: string; onClick: () => void };
  resultAction: { label: string; onClick: () => void };
}

/**
 * The board, the dice panel and the end-of-game result — everything that is
 * identical whether the state came from local React state or from Firebase.
 */
export default function GameView({
  state,
  legalMoves,
  canRoll,
  onRoll,
  onTokenClick,
  rollLabel,
  banner,
  ended,
  headerAction,
  resultAction,
}: Props) {
  const won = state.phase === 'game-over';
  const over = won || ended !== undefined;

  // One sound per state transition, driven off the version counter so a
  // re-render never replays a cue and every client hears the same events.
  const sound = useSound();
  const heard = useRef(state.version);
  useEffect(() => {
    if (state.version === heard.current) return;
    heard.current = state.version;
    const cue = cueFor(state.lastEvent);
    if (cue) sound.play(cue);
  }, [state.version, state.lastEvent, sound]);
  // Once the game is decided, the chip names the winner rather than whoever
  // happened to move last.
  const player = won
    ? state.players.find((p) => p.color === standings(state)[0]) ?? currentTurn(state)
    : currentTurn(state);

  return (
    <main className="app">
      <header className="app__bar">
        <span className="app__title">Ludo</span>
        <button
          type="button"
          className="app__mute"
          onClick={sound.toggleMuted}
          aria-pressed={sound.muted}
          aria-label={sound.muted ? 'Unmute sound' : 'Mute sound'}
          title={sound.muted ? 'Unmute' : 'Mute'}
        >
          {sound.muted ? '🔇' : '🔊'}
        </button>
        <button type="button" className="app__reset" onClick={headerAction.onClick}>
          {headerAction.label}
        </button>
      </header>

      {banner}

      <div className="app__board">
        <Board state={state} legalMoves={legalMoves} onTokenClick={onTokenClick} />
        {over && (
          <div className="result">
            <p className="result__title">
              {ended
                ? ended.title
                : `${state.players.find((p) => p.color === standings(state)[0])?.name} wins!`}
            </p>
            {ended?.subtitle && <p className="result__subtitle">{ended.subtitle}</p>}
            {won && (
              <ol className="result__list">
                {standings(state).map((color) => (
                  <li key={color} className={`result__row result__row--${color}`}>
                    <span className="result__dot" />
                    {state.players.find((p) => p.color === color)?.name}
                  </li>
                ))}
              </ol>
            )}
            <button type="button" className="result__again" onClick={resultAction.onClick}>
              {resultAction.label}
            </button>
          </div>
        )}
      </div>

      <DicePanel
        state={state}
        player={player}
        canRoll={canRoll}
        awaitingMove={state.phase === 'awaiting-move'}
        rollLabel={rollLabel}
        onRoll={onRoll}
      />
    </main>
  );
}
