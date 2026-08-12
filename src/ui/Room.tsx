import { useEffect, useState } from 'react';
import { ROOM_ERROR_TEXT, explain, joinRoom } from '../data/rooms';
import { useRoom } from '../data/useRoom';
import { usePresence } from '../data/usePresence';
import Mark, { BackArrow } from './Mark';
import OnlineGame from './OnlineGame';
import WaitingRoom from './WaitingRoom';
import './Waiting.css';

interface Props {
  roomId: string;
  uid: string;
  name: string;
  onNameChange: (name: string) => void;
  onLeave: () => void;
}

/**
 * Routes a live room snapshot to the waiting room or the game. Also handles
 * arriving straight from an invite link, where the player has not joined yet.
 */
export default function Room({ roomId, uid, name, onNameChange, onLeave }: Props) {
  const { room, loading, error } = useRoom(roomId);
  const [joinError, setJoinError] = useState<string | null>(null);

  const seated = room !== null && uid in room.players;
  // Open before the first game and again between games — only a game actually
  // being played turns an arrival away.
  const joinable = room !== null && room.status !== 'playing' && !seated;

  // Keeps this player's presence flag live, and clears it on disconnect.
  const presence = usePresence(roomId, uid, seated);

  // Someone opening ?room=CODE has a snapshot but no seat yet. A failure here
  // must be visible — a silently dropped join looks exactly like a room that
  // will not fill up.
  useEffect(() => {
    if (!joinable) return;
    let cancelled = false;
    joinRoom(roomId, uid, name.trim() || 'Player').then((result) => {
      if (!cancelled) setJoinError(result.ok ? null : explain(result));
    });
    return () => {
      cancelled = true;
    };
  }, [joinable, roomId, uid, name]);

  if (loading) {
    return (
      <Centered>
        <span className="room-seat__thinking" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        Looking for room {roomId}…
      </Centered>
    );
  }

  if (error) {
    return (
      <Centered onLeave={onLeave}>
        <strong>Could not read that room</strong>
        {error}
      </Centered>
    );
  }

  if (!room) {
    return (
      <Centered onLeave={onLeave}>
        <strong>No room with the code {roomId}</strong>
        Check the code, or ask for the invite link again.
      </Centered>
    );
  }

  if (room.status === 'waiting' || !room.gameState) {
    return (
      <WaitingRoom
        room={room}
        uid={uid}
        joinError={joinError}
        onNameChange={onNameChange}
        onLeave={onLeave}
      />
    );
  }

  // Somebody who could not be seated: the game was already under way when they
  // arrived, or the table filled up while they were joining. Say so, rather
  // than dropping them onto a board they have no part in — which is also what
  // they would meet anyway once the security rules are published, since a room
  // mid-game is only readable by the people playing it.
  if (!seated && (!joinable || joinError)) {
    return (
      <Centered onLeave={onLeave}>
        <strong>Room {roomId} is busy</strong>
        {joinError ?? ROOM_ERROR_TEXT['already-started']}
      </Centered>
    );
  }

  return (
    <OnlineGame
      room={room}
      state={room.gameState}
      uid={uid}
      presence={presence}
      onLeave={onLeave}
    />
  );
}

/**
 * What stands in for the room when there is no room to show: still the room
 * screen, with a single card saying why.
 */
function Centered({ children, onLeave }: { children: React.ReactNode; onLeave?: () => void }) {
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
        </header>

        <div className="room__scroll room__scroll--middle">
          <div className="room__card room__message">{children}</div>
          {onLeave && (
            <button type="button" className="ui-back" onClick={onLeave}>
              <BackArrow />
              Back to lobby
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
