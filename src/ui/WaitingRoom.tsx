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
import './Lobby.css';

interface Props {
  room: Room;
  uid: string;
  /** A failed auto-join from an invite link. */
  joinError?: string | null;
  onNameChange: (name: string) => void;
  onLeave: () => void;
}

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
    <main className="app app--setup">
      <div className="lobby">
        <p className="setup__subtitle">{codeCopied ? 'Code copied' : 'Room code — tap to copy'}</p>
        <button
          type="button"
          className="room-code"
          ref={codeRef}
          onClick={copyCode}
          aria-label={`Room code ${room.id.split('').join(' ')}. Tap to copy.`}
        >
          {room.id}
        </button>

        {/* Set by whoever made the room, so everyone who arrives can see what
            they have joined before the first roll. */}
        <p className="lobby__rule">
          {room.tokenCount} tokens each ·{' '}
          {room.yardExit === 'one-or-six' ? 'out on a 1 or a 6' : 'out on a 6'}
        </p>

        <button type="button" className="lobby__secondary" onClick={copyLink}>
          {copied ? 'Link copied' : 'Copy invite link'}
        </button>

        {manualLink && (
          <label className="lobby__manual">
            <span className="field__label">Copy this link</span>
            <input
              className="field__input lobby__manual-link"
              value={manualLink}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              ref={(el) => el?.select()}
            />
          </label>
        )}

        <ul className="seat-list">
          {seats.map(([playerUid, player]) => (
            <li key={playerUid} className={`seat-row seat-row--${player.color}`}>
              <span className="seat__swatch" />
              {playerUid === uid ? (
                <input
                  className="seat-row__input"
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
                <span className="seat-row__name">{player.name}</span>
              )}
              {!isPresent(player) && <span className="seat-row__tag seat-row__tag--away">away</span>}
              {playerUid === room.hostId && <span className="seat-row__tag">host</span>}
              {playerUid === uid && <span className="seat-row__tag">you</span>}
            </li>
          ))}
          {Array.from({ length: MAX_PLAYERS - seats.length }, (_, i) => (
            <li key={`empty-${i}`} className="seat-row seat-row--empty">
              Waiting for a player…
            </li>
          ))}
        </ul>

        <div className="color-picker" role="group" aria-label="Your colour">
          {COLORS.map((color) => {
            const owner = seats.find(([, player]) => player.color === color);
            const mine = owner?.[0] === uid;
            const taken = owner !== undefined && !mine;
            return (
              <button
                key={color}
                type="button"
                className={`color-chip color-chip--${color}${mine ? ' color-chip--mine' : ''}`}
                disabled={taken}
                aria-pressed={mine}
                aria-label={`${color}${taken ? ` (taken by ${owner[1].name})` : ''}`}
                onClick={() => void takeColor(color)}
              />
            );
          })}
        </div>

        {isHost ? (
          <button
            type="button"
            className="setup__start"
            onClick={start}
            disabled={!enough || busy}
          >
            {busy ? 'Starting…' : enough ? `Start ${seats.length}-player game` : 'Need 2 players'}
          </button>
        ) : (
          <p className="lobby__pending">Waiting for the host to start…</p>
        )}

        {(error ?? joinError) && (
          <div className="notice notice--error">{error ?? joinError}</div>
        )}

        <button type="button" className="link-button" onClick={onLeave}>
          Leave room
        </button>
      </div>
    </main>
  );
}
