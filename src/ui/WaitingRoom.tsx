import { useCallback, useEffect, useState } from 'react';
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

  const copyLink = async () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${room.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(url);
    }
  };

  return (
    <main className="app app--setup">
      <div className="lobby">
        <p className="setup__subtitle">Room code</p>
        <p className="room-code">{room.id}</p>

        {/* Set by whoever made the room, so everyone who arrives can see what
            they have joined before the first roll. */}
        <p className="lobby__rule">{room.tokenCount} tokens each</p>

        <button type="button" className="lobby__secondary" onClick={copyLink}>
          {copied ? 'Link copied' : 'Copy invite link'}
        </button>

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
