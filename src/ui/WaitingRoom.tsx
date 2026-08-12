import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MAX_PLAYERS,
  explain,
  isPresent,
  setPlayerColor,
  setPlayerName,
  startGame,
} from '../data/rooms';
import type { Room } from '../data/serialize';
import type { Color } from '../game/types';
import { COLORS } from '../game/types';
import { copyText } from './clipboard';
import Mark, { BackArrow, LeaveIcon } from './Mark';
import './Waiting.css';

interface Props {
  room: Room;
  uid: string;
  /** A failed auto-join from an invite link. */
  joinError?: string | null;
  onNameChange: (name: string) => void;
  onLeave: () => void;
}

/**
 * The room before the first roll: the code to share, who has arrived, and the
 * colour each of them is playing.
 *
 * Dressed as the end-of-game screen it will become — the same bar, the same
 * room strip, the same colour-edged seats and the same key-marked strip that
 * carries the game — so that leaving a game and setting one up look like the
 * same room at two moments.
 */
export default function WaitingRoom({ room, uid, joinError, onNameChange, onLeave }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const [manualLink, setManualLink] = useState<string | null>(null);
  const codeRef = useRef<HTMLButtonElement>(null);
  // Someone who arrived by invite link never saw the home screen, so this is
  // their only chance to be something other than "Player".
  const [draftName, setDraftName] = useState<string | null>(null);

  const myName = room.players[uid]?.name ?? '';

  const commitName = useCallback(
    (raw: string) => {
      const next = raw.trim().slice(0, 16);
      if (!next || next === myName) return;
      onNameChange(next);
      void setPlayerName(room.id, uid, next);
    },
    [myName, onNameChange, room.id, uid],
  );

  // Save shortly after typing stops rather than only on blur — otherwise a name
  // is lost when the host starts the game while the field still has focus.
  useEffect(() => {
    if (draftName === null) return;
    const timer = setTimeout(() => commitName(draftName), 500);
    return () => clearTimeout(timer);
  }, [draftName, commitName]);

  const seats = Object.entries(room.players).sort(
    (a, b) => COLORS.indexOf(a[1].color) - COLORS.indexOf(b[1].color),
  );
  const isHost = room.hostId === uid;
  const enough = seats.length >= 2;
  const hostName = room.players[room.hostId]?.name ?? 'the host';

  const takeColor = async (color: Color) => {
    setError(null);
    const result = await setPlayerColor(room.id, uid, color);
    if (!result.ok && result.error !== 'nothing-to-do') setError(explain(result));
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    const result = await startGame(room.id, uid);
    setBusy(false);
    if (!result.ok) setError(explain(result));
  };

  /**
   * The code itself, for someone reading it out or typing it into the join box.
   * If the clipboard is out of reach, select the characters instead so they can
   * be copied by hand — the code is already on screen, so there is nothing to
   * reveal and nothing to apologise for.
   */
  const copyCode = async () => {
    if (await copyText(room.id)) {
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 1600);
      return;
    }
    const element = codeRef.current;
    if (!element) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  /**
   * Copying can fail for reasons that are nobody's fault — most often because
   * the page was opened over a LAN address, where the clipboard API does not
   * exist. That is not an error to report; it just means the link has to be
   * copied by hand, so show it ready to be selected.
   */
  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${room.id}`;
    if (await copyText(url)) {
      setManualLink(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else {
      setManualLink(url);
    }
  };

  return (
    <main className="room">
      <div className="room__scene" aria-hidden="true">
        <div className="room__board room__board--left" />
        <div className="room__board room__board--right" />
        <div className="room__veil" />
      </div>

      <div className="room__inner">
        <header className="room__bar">
          <Mark />
          <button type="button" className="ui-leave" onClick={onLeave}>
            Leave
            <LeaveIcon />
          </button>
        </header>

        <div className="room__scroll">
          {/* The code, given the room it deserves — it is the one thing on this
              screen that has to reach someone who is not looking at it. */}
          <section className="room__card room__invite">
            <p className="room__label">{codeCopied ? 'Code copied' : 'Room code — tap to copy'}</p>
            <button
              type="button"
              className="room__code"
              ref={codeRef}
              onClick={copyCode}
              aria-label={`Room code ${room.id.split('').join(' ')}. Tap to copy.`}
            >
              {room.id}
            </button>
            {/* Set by whoever made the room, so everyone who arrives can see
                what they have joined before the first roll. */}
            <p className="room__rules">
              {room.tokenCount} tokens each ·{' '}
              {room.yardExit === 'one-or-six' ? 'out on a 1 or a 6' : 'out on a 6'}
            </p>
            <button type="button" className="room__share" onClick={copyLink}>
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M10 13.5a4 4 0 0 0 5.7.4l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
                <path d="M14 10.5a4 4 0 0 0-5.7-.4l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
              </svg>
              {copied ? 'Link copied' : 'Copy invite link'}
            </button>

            {manualLink && (
              <label className="room__manual">
                <span className="room__label">Copy this link</span>
                <input
                  className="room__manual-link"
                  value={manualLink}
                  readOnly
                  onFocus={(e) => e.currentTarget.select()}
                  ref={(el) => el?.select()}
                />
              </label>
            )}
          </section>

          <section className="room__card room__table">
            <div className="room__legend">
              <span className="room__legend-dot" />
              WHO IS HERE
              <span className="room__legend-dot" />
            </div>

            <ul className="room__seats">
              {seats.map(([playerUid, player]) => (
                <li key={playerUid} className={`room-seat ui-tint--${player.color}`}>
                  <span className="ui-dot" />
                  {playerUid === uid ? (
                    <input
                      className="room-seat__input"
                      value={draftName ?? player.name}
                      maxLength={16}
                      placeholder="Your name"
                      aria-label="Your name"
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={(e) => commitName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                  ) : (
                    <span className="room-seat__name">{player.name}</span>
                  )}
                  {!isPresent(player) && (
                    <span className="room-seat__pill room-seat__pill--away">AWAY</span>
                  )}
                  {playerUid === room.hostId && <span className="room-seat__pill">HOST</span>}
                  {playerUid === uid && <span className="room-seat__pill">YOU</span>}
                </li>
              ))}
              {Array.from({ length: MAX_PLAYERS - seats.length }, (_, i) => (
                <li key={`empty-${i}`} className="room-seat room-seat--empty">
                  <span className="room-seat__thinking" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  Waiting for a player…
                </li>
              ))}
            </ul>

            <hr className="room__hr" />

            <p className="room__label">Your colour</p>
            <div className="room__chips" role="group" aria-label="Your colour">
              {COLORS.map((color) => {
                const owner = seats.find(([, player]) => player.color === color);
                const mine = owner?.[0] === uid;
                const taken = owner !== undefined && !mine;
                return (
                  <button
                    key={color}
                    type="button"
                    className={`room-chip ui-tint--${color}${mine ? ' room-chip--mine' : ''}`}
                    disabled={taken}
                    aria-pressed={mine}
                    aria-label={`${color}${taken ? ` (taken by ${owner[1].name})` : ''}`}
                    onClick={() => void takeColor(color)}
                  />
                );
              })}
            </div>

            {/* The one strip that carries the game, as on the end screen: a
                notice while the room is short-handed, the button once it is
                not. Only the host has it to press. */}
            {isHost ? (
              <button
                type="button"
                className={`room__start${enough ? ' room__start--ready' : ''}`}
                onClick={start}
                disabled={!enough || busy}
              >
                <span className="room__key" aria-hidden="true">
                  <i className="room__key-bar" />
                  <i className="room__key-up" />
                  <i className="room__key-down" />
                  <i className="room__key-bar" />
                </span>
                <span className="room__start-text">
                  <strong>
                    {busy
                      ? 'STARTING…'
                      : enough
                        ? `START ${seats.length}-PLAYER GAME`
                        : 'WAITING FOR SOMEONE TO JOIN'}
                  </strong>
                  <em>
                    {enough
                      ? 'Everyone here gets a seat'
                      : 'Share the room code with your friend'}
                  </em>
                </span>
              </button>
            ) : (
              <div className="room__start" aria-live="polite">
                <span className="room__key" aria-hidden="true">
                  <i className="room__key-bar" />
                  <i className="room__key-up" />
                  <i className="room__key-down" />
                  <i className="room__key-bar" />
                </span>
                <span className="room__start-text">
                  <strong>WAITING FOR {hostName.toUpperCase()}</strong>
                  <em>{`${hostName} starts the game when everyone is here`}</em>
                </span>
              </div>
            )}

            {(error ?? joinError) && <p className="room__error">{error ?? joinError}</p>}
          </section>

          <button type="button" className="ui-back" onClick={onLeave}>
            <BackArrow />
            Leave room
          </button>
        </div>
      </div>
    </main>
  );
}
