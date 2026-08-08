import { useEffect, useState } from 'react';
import { explain, joinRoom } from '../data/rooms';
import { useRoom } from '../data/useRoom';
import { usePresence } from '../data/usePresence';
import OnlineGame from './OnlineGame';
import WaitingRoom from './WaitingRoom';
import './Lobby.css';

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
  const joinable = room !== null && room.status === 'waiting' && !seated;

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
    return <Centered>Loading room…</Centered>;
  }

  if (error) {
    return (
      <Centered onLeave={onLeave}>
        <div className="notice notice--error">Could not read that room: {error}</div>
      </Centered>
    );
  }

  if (!room) {
    return (
      <Centered onLeave={onLeave}>
        <div className="notice notice--error">No room with the code {roomId}.</div>
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

function Centered({ children, onLeave }: { children: React.ReactNode; onLeave?: () => void }) {
  return (
    <main className="app app--setup">
      <div className="lobby">
        {children}
        {onLeave && (
          <button type="button" className="link-button" onClick={onLeave}>
            Back to lobby
          </button>
        )}
      </div>
    </main>
  );
}
