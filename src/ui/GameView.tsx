import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import dieFive from '../assets/dice-5.svg';
import { currentTurn, standings } from '../game/engine';
import type { GameEvent, GameState, Move } from '../game/types';
import Board from './Board';
import DicePanel from './DicePanel';
import Mark, { LeaveIcon, SoundIcon } from './Mark';
import Trophy from './Trophy';
import { useSound, type Cue, type Sound } from './useSound';
import './Game.css';

/**
 * How much of the height it is given the board takes. The rest is air above and
 * below it, and room for the light around its edge to glow into.
 */
const BOARD_SHARE = 0.92;

/**
 * The largest square that fits the space left for the board, measured rather
 * than reserved.
 *
 * The board has to fit inside whatever the bar, the strip and the dice panel
 * leave, on every phone, with or without the strip, and with the strip a line
 * taller when somebody is away. Every attempt to say that in CSS alone either
 * guessed the height of the rest (and drifted) or leaned on units an older
 * phone browser ignores — and a board with no width of its own covers the dice.
 * Asking the element how big it is works everywhere.
 */
function useSquare(stage: React.RefObject<HTMLDivElement | null>): number | null {
  const [size, setSize] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;

    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setSize(Math.max(0, Math.floor(Math.min(width, height * BOARD_SHARE))));
    };
    measure();

    // The stage takes the space left over rather than sizing to its contents,
    // so setting the board's size can never resize the stage and call this
    // again — there is no loop to guard against.
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [stage]);

  return size;
}

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
  /**
   * A screen of its own for the end of the game, drawn over everything here
   * rather than in place of it — the board stays mounted underneath, so the
   * winning move is still walked out and heard before this covers it.
   *
   * Given the game's sound, so that muting on the end screen is muting here.
   */
  renderOver?: (sound: Sound) => ReactNode;
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
  renderOver,
}: Props) {
  const won = state.phase === 'game-over';
  const over = won || ended !== undefined;

  const stage = useRef<HTMLDivElement>(null);
  const square = useSquare(stage);

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
    <main className="game">
      <header className="game__bar">
        <Mark />
        <div className="game__actions">
          <button
            type="button"
            className="ui-icon"
            onClick={sound.toggleMuted}
            aria-pressed={sound.muted}
            aria-label={sound.muted ? 'Unmute sound' : 'Mute sound'}
            title={sound.muted ? 'Unmute' : 'Mute'}
          >
            <SoundIcon muted={sound.muted} />
          </button>
          <button type="button" className="ui-leave" onClick={headerAction.onClick}>
            {headerAction.label}
            <LeaveIcon />
          </button>
        </div>
      </header>

      {banner}

      {/* The stage takes whatever height the bar, the strip and the dice panel
          leave, and the board is the largest square that fits inside it — see
          Game.css. The light around it is the colour of whoever is to play, and
          of the winner once there is one. */}
      <div className="game__stage" ref={stage}>
        <div
          className="game__board"
          style={
            {
              '--ring': `var(--play-${player.color})`,
              ...(square === null ? {} : { width: square }),
            } as CSSProperties
          }
        >
          <Board
            state={state}
            legalMoves={movesForDie}
            onTokenClick={(tokenId) => selectedDie !== null && onTokenClick(tokenId, selectedDie)}
            onStep={() => sound.play('step')}
            onArrive={() => setPlayed(state.version)}
          />
        </div>
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

      {/* Last, and over everything: the board keeps playing the winning move
          out behind it. */}
      {over && renderOver?.(sound)}

      {/* The end of a game with no room behind it — one played on this device,
          or one being watched. The same cup and the same places as the online
          end screen; what it has not got is a table to ask about a rematch. */}
      {over && !renderOver && (
        <div className="end">
          <div className="end__inner">
            <div className="end__card">
              {won && (
                <div className="end__trophy">
                  <span className="end__glow" aria-hidden="true" />
                  <Trophy />
                </div>
              )}

              <div className="end__headline">
                <span className="end__flourish" aria-hidden="true">
                  ❦
                </span>
                <h2 className="end__title">
                  {ended ? ended.title : `${player.name} wins!`}
                </h2>
                <span className="end__flourish end__flourish--flip" aria-hidden="true">
                  ❦
                </span>
              </div>

              {ended?.subtitle && <p className="end__note">{ended.subtitle}</p>}

              {won && (
                <ol className="end__places">
                  {standings(state).map((color, place) => (
                    <li key={color} className={`end__place ui-tint--${color}`}>
                      <span className="end__rank">{place + 1}.</span>
                      <span className="ui-dot" />
                      <span className="end__name">
                        {state.players.find((p) => p.color === color)?.name}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <button type="button" className="end__again" onClick={resultAction.onClick}>
              <img src={dieFive} alt="" />
              {resultAction.label}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
