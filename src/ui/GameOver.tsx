import { useState } from 'react';
import dieFour from '../assets/dice-4.svg';
import {
  explain,
  rematchLineup,
  setRematchRules,
  startRematch,
  voteRematch,
  type Result,
} from '../data/rooms';
import type { Room } from '../data/serialize';
import { standings } from '../game/engine';
import type { GameState } from '../game/types';
import { COLORS } from '../game/types';
import Mark, { BackArrow, LeaveIcon, SoundIcon } from './Mark';
import OptionRow from './OptionRow';
import { COUNT_CHOICES, EXIT_CHOICES } from './RulePicker';
import type { Sound } from './useSound';
import './GameOver.css';

interface Props {
  room: Room;
  state: GameState;
  uid: string;
  /** The game's own sound, so muting here is muting everywhere. */
  sound: Sound;
  onLeave: () => void;
}

type Answer = 'in' | 'out' | 'asked';

/**
 * The end of a game: who won, and what the table does next.
 *
 * Drawn over the board rather than in place of it, so the winning move is still
 * walked out and heard before this covers it up. The rematch is settled here —
 * the host sets the rules and starts it, everyone else answers — see
 * decideRematchStart for who ends up being dealt in.
 */
export default function GameOver({ room, state, uid, sound, onLeave }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abandoned = room.endedReason === 'abandoned';
  const order = standings(state);
  const winner = abandoned ? null : state.players.find((p) => p.color === order[0]) ?? null;

  const isHost = room.hostId === uid;
  const { tokenCount, yardExit, votes } = room.rematch;
  const lineup = new Set(rematchLineup(room.hostId, room.players, votes));
  const seats = Object.entries(room.players).sort(
    (a, b) => COLORS.indexOf(a[1].color) - COLORS.indexOf(b[1].color),
  );
  const hostName = room.players[room.hostId]?.name ?? 'the host';
  const myVote = votes[uid];
  const mySeat = room.players[uid];
  const ready = lineup.size >= 2;

  const run = async (write: Promise<Result<void>>) => {
    setBusy(true);
    setError(null);
    const result = await write;
    setBusy(false);
    // The reducer's word for a write that changed nothing: a second tap on the
    // answer already given is not something to complain about.
    if (!result.ok && result.error !== 'nothing-to-do') setError(explain(result));
  };

  /** How a seat has answered, with the host counted in for starting it. */
  const answer = (playerUid: string): Answer => {
    if (lineup.has(playerUid)) return 'in';
    return votes[playerUid] === 'out' ? 'out' : 'asked';
  };

  return (
    <div className="over">
      <div className="over__scene" aria-hidden="true">
        <div className="over__board over__board--left" />
        <div className="over__board over__board--right" />
        <div className="over__veil" />
      </div>

      <div className="over__inner">
        <header className="over__bar">
          <Mark />
          <div className="over__actions">
            <button
              type="button"
              className="ui-icon"
              onClick={sound.toggleMuted}
              aria-pressed={sound.muted}
              aria-label={sound.muted ? 'Unmute sound' : 'Mute sound'}
            >
              <SoundIcon muted={sound.muted} />
            </button>
            <button type="button" className="ui-leave" onClick={onLeave}>
              Leave
              <LeaveIcon />
            </button>
          </div>
        </header>

        <div className="over__room">
          <div className="over__room-left">
            <span className="over__room-label">Room</span>
            <span className="over__code">{room.id}</span>
            <span className="over__room-label">
              {abandoned ? 'Abandoned' : 'Game over'}
            </span>
          </div>
          {mySeat && (
            <div className={`over__you over-tint--${mySeat.color}`}>
              <span className="over-dot" />
              {mySeat.color}
            </div>
          )}
        </div>

        <div className="over__scroll">
          <div className="over__card">
            <div className="over__crest">
              {!abandoned && (
                <div className="over__trophy">
                  <span className="over__glow" aria-hidden="true" />
                  <svg width="140" height="150" viewBox="0 0 230 250" aria-hidden="true">
                    <defs>
                      <linearGradient id="over-gold" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#ffe98a" />
                        <stop offset=".45" stopColor="#ffc22e" />
                        <stop offset="1" stopColor="#e08c05" />
                      </linearGradient>
                    </defs>
                    <path
                      d="M60 30h110v52c0 34-24 60-55 60S60 116 60 82z"
                      fill="url(#over-gold)"
                      stroke="#c47a05"
                      strokeWidth="4"
                    />
                    <path
                      d="M60 44H36c-6 0-10 5-9 11 4 26 20 40 40 43"
                      fill="none"
                      stroke="url(#over-gold)"
                      strokeWidth="14"
                      strokeLinecap="round"
                    />
                    <path
                      d="M170 44h24c6 0 10 5 9 11-4 26-20 40-40 43"
                      fill="none"
                      stroke="url(#over-gold)"
                      strokeWidth="14"
                      strokeLinecap="round"
                    />
                    <rect x="104" y="140" width="22" height="34" fill="url(#over-gold)" />
                    <rect x="76" y="174" width="78" height="16" rx="6" fill="url(#over-gold)" />
                    <rect x="62" y="190" width="106" height="22" rx="8" fill="#e8a010" />
                    <path
                      d="M115 56l10 21 23 3-17 16 4 23-20-11-20 11 4-23-17-16 23-3z"
                      fill="#fff3c4"
                    />
                  </svg>
                  <span className="over__ribbon">WINNER</span>
                  <img className="over__die over__die--left" src={dieFour} alt="" />
                  <img className="over__die over__die--right" src={dieFour} alt="" />
                  <span className="over__bit over__bit--pink" aria-hidden="true" />
                  <span className="over__bit over__bit--blue" aria-hidden="true" />
                  <span className="over__spark" aria-hidden="true">
                    ✦
                  </span>
                </div>
              )}

              {/* The words and the places travel together: stacked under the
                  trophy on a phone, standing beside it once there is width. */}
              <div className="over__said">
                <div className="over__headline">
                <span className="over__flourish" aria-hidden="true">
                  ❦
                </span>
                <h2 className="over__title">
                  {abandoned ? 'GAME ABANDONED' : `${winner?.name ?? 'Nobody'} wins!`}
                  {!abandoned && (
                    <span className="over__title-crown" aria-hidden="true">
                      <span className="over__crown-points" />
                      <span className="over__crown-band" />
                    </span>
                  )}
                </h2>
                <span className="over__flourish over__flourish--flip" aria-hidden="true">
                  ❦
                </span>
              </div>

                {abandoned ? (
                  <p className="over__note">Everyone else left the table.</p>
                ) : (
                  <ol className="over__standings">
                    {order.map((color, place) => (
                      <li key={color} className={`over__place over-tint--${color}`}>
                        <span className="over__rank">{place + 1}.</span>
                        <span className="over-dot" />
                        <span className="over__place-name">
                          {state.players.find((p) => p.color === color)?.name}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>

            <div className="over__again">
              <div className="over__legend">
                <span className="over__legend-dot" />
                PLAY AGAIN?
                <span className="over__legend-dot" />
              </div>

              <ul className="over__seats">
                {seats.map(([playerUid, player]) => (
                  <li
                    key={playerUid}
                    className={`over-seat over-tint--${player.color} over-seat--${answer(playerUid)}`}
                  >
                    <span className="over-dot" />
                    <span className="over-seat__name">
                      {player.name}
                      {playerUid === uid && ' (you)'}
                    </span>
                    {answer(playerUid) === 'asked' ? (
                      <span className="over-seat__thinking" aria-label="Still deciding">
                        <i />
                        <i />
                        <i />
                      </span>
                    ) : (
                      <span className={`over-seat__pill over-seat__pill--${answer(playerUid)}`}>
                        {answer(playerUid) === 'in' ? 'IN' : 'OUT'}
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              <hr className="over__rule" />

              {isHost ? (
                <div className="over__rules">
                  <div className="over-choices over-choices--tokens">
                    <OptionRow
                      label="TOKENS EACH"
                      choices={COUNT_CHOICES}
                      value={tokenCount}
                      onChange={(count) =>
                        void run(setRematchRules(room.id, uid, count, yardExit))
                      }
                      disabled={busy}
                    />
                  </div>
                  <div className="over-choices over-choices--yard">
                    <OptionRow
                      label="LEAVE THE YARD ON"
                      choices={EXIT_CHOICES}
                      value={yardExit}
                      onChange={(exit) =>
                        void run(setRematchRules(room.id, uid, tokenCount, exit))
                      }
                      disabled={busy}
                    />
                  </div>
                </div>
              ) : (
                <div className="over__answer">
                  <p className="over__rules-read">
                    {tokenCount} tokens each ·{' '}
                    {yardExit === 'one-or-six' ? 'out on a 1 or a 6' : 'out on a 6'}
                  </p>
                  <div className="over__answer-buttons">
                    <button
                      type="button"
                      className={`over__answer-button${myVote === 'in' ? ' over__answer-button--on' : ''}`}
                      aria-pressed={myVote === 'in'}
                      disabled={busy}
                      onClick={() => void run(voteRematch(room.id, uid, 'in'))}
                    >
                      I&apos;m in
                    </button>
                    <button
                      type="button"
                      className={`over__answer-button${myVote === 'out' ? ' over__answer-button--on' : ''}`}
                      aria-pressed={myVote === 'out'}
                      disabled={busy}
                      onClick={() => void run(voteRematch(room.id, uid, 'out'))}
                    >
                      No thanks
                    </button>
                  </div>
                </div>
              )}

              {/* The one strip that carries the next game: a notice while the
                  table is still making up its mind, and the button that starts
                  it once enough of them are in. */}
              {isHost ? (
                <button
                  type="button"
                  className={`over__start${ready ? ' over__start--ready' : ''}`}
                  disabled={busy || !ready}
                  onClick={() => void run(startRematch(room.id, uid))}
                >
                  <span className="over__key" aria-hidden="true">
                    <i className="over__key-bar" />
                    <i className="over__key-up" />
                    <i className="over__key-down" />
                    <i className="over__key-bar" />
                  </span>
                  <span className="over__start-text">
                    <strong>
                      {ready ? `START REMATCH (${lineup.size})` : 'WAITING FOR SOMEONE TO JOIN IN'}
                    </strong>
                    <em>
                      {ready
                        ? 'Everyone who is in gets a seat'
                        : 'Share the room code with your friend'}
                    </em>
                  </span>
                </button>
              ) : (
                <div className="over__start" aria-live="polite">
                  <span className="over__key" aria-hidden="true">
                    <i className="over__key-bar" />
                    <i className="over__key-up" />
                    <i className="over__key-down" />
                    <i className="over__key-bar" />
                  </span>
                  <span className="over__start-text">
                    <strong>
                      {myVote === 'in' ? `WAITING FOR ${hostName.toUpperCase()}` : 'ARE YOU IN?'}
                    </strong>
                    <em>{`${hostName} sets the rules and starts the next game`}</em>
                  </span>
                </div>
              )}

              {error && <p className="over__error">{error}</p>}

              <button type="button" className="over__back" onClick={onLeave}>
                <BackArrow />
                Back to lobby
              </button>
            </div>
          </div>

          {/* The dice panel, as it stands once there is nothing left to roll. */}
          <div className="over__panel">
            <div className={`over__panel-who over-tint--${winner?.color ?? mySeat?.color ?? 'blue'}`}>
              <span className="over__avatar">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="#d9ffdd">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" />
                </svg>
              </span>
              <span className="over__panel-text">
                <strong>{abandoned ? 'Nobody' : winner?.name}</strong>
                <em>Finished</em>
              </span>
            </div>
            <span className="over__panel-die">?</span>
          </div>
        </div>
      </div>
    </div>
  );
}
