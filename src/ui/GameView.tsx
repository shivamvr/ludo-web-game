import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  /** The die is passed back because a token can often be moved by either number. */
  onTokenClick: (tokenId: string, die: number) => void;
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

  /**
   * Which held number the player is about to spend. Only the numbers that can
   * actually be used are offered, so a held six with nowhere to go never
   * swallows a tap.
   */
  const playableDice = useMemo(
    () => [...new Set(legalMoves.map((m) => m.die))].sort((a, b) => a - b),
    [legalMoves],
  );
  const [chosen, setChosen] = useState<number | null>(null);
  // Any change to the position invalidates the choice; the default below then
  // falls back to the first number that can be played.
  useEffect(() => setChosen(null), [state.version]);

  const selectedDie =
    chosen !== null && playableDice.includes(chosen) ? chosen : playableDice[0] ?? null;
  const movesForDie = useMemo(
    () => legalMoves.filter((m) => m.die === selectedDie),
    [legalMoves, selectedDie],
  );

  // One sound per state transition, driven off the version counter so a
  // re-render never replays a cue and every client hears the same events.
  //
  // The cue waits for the board to finish acting the move out. A capture should
  // be heard when the tokens collide, not when the write lands — and with a
  // token walking a square at a time those are up to half a second apart. The
  // board reports arrival at once when there is nothing to walk, so a roll or a
  // skipped turn still sounds immediately.
  const sound = useSound();
  const [played, setPlayed] = useState(state.version);
  const heard = useRef(state.version);
  useEffect(() => {
    if (played !== state.version || heard.current === state.version) return;
    heard.current = state.version;
    const cue = cueFor(state.lastEvent);
    if (cue) sound.play(cue);
  }, [played, state.version, state.lastEvent, sound]);
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
        <Board
          state={state}
          legalMoves={movesForDie}
          onTokenClick={(tokenId) => selectedDie !== null && onTokenClick(tokenId, selectedDie)}
          onStep={() => sound.play('step')}
          onArrive={() => setPlayed(state.version)}
        />
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
        selectedDie={selectedDie}
        playableDice={playableDice}
        onSelectDie={(die) => {
          setChosen(die);
          sound.play('select');
        }}
        rollLabel={rollLabel}
        onRoll={onRoll}
      />
    </main>
  );
}
